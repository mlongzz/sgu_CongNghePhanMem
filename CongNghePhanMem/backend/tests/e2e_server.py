"""Disposable local browser-test backend. Never reads the configured application DB."""
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
runtime = tempfile.TemporaryDirectory(prefix="multilingual-guide-e2e-")
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(runtime.name) / "test.db").replace("\\", "/")
os.environ["UPLOAD_DIR"] = str(Path(runtime.name) / "uploads")
os.environ["SECRET_KEY"] = "isolated-browser-test-secret-never-for-production"
os.environ["ADMIN_USER_IDS"] = ""
os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:8099,http://localhost:8099"
os.environ["TRANSLATION_API_URL"] = ""

from app.database import Base, engine, SessionLocal
from app.main import app
from app.models.place import Place
from app.models.guide_content import GuideContent
from app.models.user import User
import httpx2 as httpx
from app.services.osm_service import OsmNearbyService, get_osm_service

# Exercise the real /osm/nearby endpoint without contacting public providers in browser tests.
def mock_overpass(request):
    return httpx.Response(200, json={"elements": [{"type": "node", "id": 9001, "lat": 10.7764,
        "lon": 106.6993, "tags": {"name": "Backend OSM Test Park", "leisure": "park"}}]})

osm_test_service = OsmNearbyService(lambda: httpx.AsyncClient(transport=httpx.MockTransport(mock_overpass)), allow_network=True)
app.dependency_overrides[get_osm_service] = lambda: osm_test_service
from pwdlib import PasswordHash
hash_password = PasswordHash.recommended().hash

Base.metadata.create_all(engine)
with SessionLocal() as db:
    db.add(User(email="admin@e2e.example.com", password_hash=hash_password("TestPassword123!"), full_name="Browser Test Admin", role="admin", language="vi"))
    place = Place(name="Browser Test Museum", description="Verified place description", latitude=10.7764, longitude=106.6993, address="Test address", category="Văn hóa")
    db.add(place)
    db.flush()
    for language in ("vi", "en", "fr", "ja"):
        db.add(GuideContent(place_id=place.id, language_code=language, title="Test guide", content=f"Verified test narration in {language}."))
    db.commit()

if __name__ == "__main__":
    import uvicorn
    try:
        uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
    finally:
        engine.dispose()
        runtime.cleanup()
