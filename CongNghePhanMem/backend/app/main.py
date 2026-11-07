"""
Application entry point.
- Leaves schema updates to reviewed Alembic migrations
- Configures CORS
- Registers all routers
- Adds global exception handler and structured logging
"""
import logging
import time
import asyncio
import os
from contextlib import suppress

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import ALLOWED_ORIGINS, LAN_ORIGIN_REGEX
from app.database import get_db
from app.models import admin, audio_session, favorite, guide_content, history, place, review, user  # noqa: F401
from app.routers import auth, users
from app.routers.admin import router as admin_router
from app.routers.audio_sessions import router as audio_sessions_router
from app.routers.favorites import router as favorites_router
from app.routers.guide_content import router as guide_content_router
from app.routers.history import router as history_router
from app.routers.places import router as places_router
from app.routers.reviews import router as reviews_router
from app.routers.journeys import router as journeys_router
from app.routers.media import router as media_router
from app.routers.osm import router as osm_router, admin_router as osm_admin_router
from app.routers.presence import router as presence_router
from app.routers.image_manager import router as image_manager_router

# ─── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ─── Lifespan (startup / shutdown) ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    from app.services.image_storage import storage_configuration
    storage_configuration()
    logger.info("Schema managed by Alembic; run alembic upgrade head before startup.")
    task = None
    if os.getenv('APP_ENV') != 'test':
        from app.services.presence_cleanup import retention_worker
        task = asyncio.create_task(retention_worker())
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
    logger.info("Application shutting down.")


# ─── App instance ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="Multilingual Guide API",
    description=(
        "REST API for the Multilingual Guide mobile app. "
        "Provides endpoints for places, guide content, favorites, visit history, and reviews."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LAN_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request timing middleware ────────────────────────────────────────────────
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s — %d (%.1f ms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


# ─── Global exception handler ─────────────────────────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again later."},
    )


# ─── Routers ──────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin_router)
app.include_router(audio_sessions_router)
app.include_router(places_router)
app.include_router(favorites_router)
app.include_router(history_router)
app.include_router(guide_content_router)
app.include_router(reviews_router)
app.include_router(journeys_router)
app.include_router(media_router)
app.include_router(osm_router)
app.include_router(osm_admin_router)
app.include_router(presence_router)
app.include_router(image_manager_router)


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def root():
    """Simple health-check endpoint."""
    return {"status": "ok", "message": "Multilingual Guide API is running", "version": "2.0.0"}


@app.get("/settings", tags=["Configuration"])
def public_settings(db: Session = Depends(get_db)):
    from app.routers.admin import read_settings
    return read_settings(db)

@app.get('/health/live', tags=['Health'])
def health_live():
    return {'status': 'ok'}

@app.get('/health/ready', tags=['Health'])
def health_ready(db: Session = Depends(get_db)):
    try:
        db.execute(text('SELECT 1'))
        db.execute(text('SELECT thumbnail_url FROM place_images LIMIT 0'))
        db.execute(text('SELECT id FROM user_presence_sessions LIMIT 0'))
        return {'status': 'ready'}
    except Exception:
        return JSONResponse(status_code=503, content={'status': 'unavailable'})
