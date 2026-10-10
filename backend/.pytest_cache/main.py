"""
Application entry point.
- Creates all DB tables on startup
- Configures CORS
- Registers all routers
- Adds global exception handler and structured logging
"""
import logging
import time

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import ALLOWED_ORIGINS
from app.database import Base, engine
from app.models import audio_session, favorite, guide_content, history, place, review, user  # noqa: F401 — ensure all models are registered
from app.routers import auth, users
from app.routers.admin import router as admin_router
from app.routers.audio_sessions import router as audio_sessions_router
from app.routers.favorites import router as favorites_router
from app.routers.guide_content import router as guide_content_router
from app.routers.history import router as history_router
from app.routers.places import router as places_router
from app.routers.reviews import router as reviews_router

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
    logger.info("Creating database tables…")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ready.")
    yield
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


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def root():
    """Simple health-check endpoint."""
    return {"status": "ok", "message": "Multilingual Guide API is running", "version": "2.0.0"}
