"""Disposable local browser-test backend. Never reads the configured application DB."""
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
runtime = tempfile.TemporaryDirectory(prefix="multilingual-guide-e2e-")
test_database = os.getenv('E2E_DATABASE_URL')
if test_database:
    import re
    from sqlalchemy.engine import make_url
    url = make_url(test_database)
    if url.get_backend_name() != 'postgresql' or url.host not in {'localhost', '127.0.0.1', '::1'} or not re.fullmatch(r'mg_test_[a-zA-Z0-9_]+', url.database or ''):
        raise RuntimeError('E2E requires an explicitly isolated local mg_test_ PostgreSQL database')
os.environ["DATABASE_URL"] = test_database or "sqlite:///" + str(Path(runtime.name) / "test.db").replace("\\", "/")
os.environ["UPLOAD_DIR"] = str(Path(runtime.name) / "uploads")
os.environ["SECRET_KEY"] = "isolated-browser-test-secret-never-for-production"
os.environ["ADMIN_USER_IDS"] = ""
os.environ["ALLOWED_ORIGINS"] = "http://127.0.0.1:8099,http://localhost:8099"
os.environ["TRANSLATION_API_URL"] = ""
os.environ["APP_ENV"] = "test"
os.environ["MEDIA_STORAGE_BACKEND"] = "local"
# One fixture Admin is used repeatedly by the whole browser suite. Throttle logic
# remains enabled; production defaults and rejection are tested separately in pytest.
os.environ['AUTH_LOGIN_LIMIT'] = '200'
os.environ['AUTH_IP_LOGIN_LIMIT'] = '1000'

from app.database import Base, engine, SessionLocal
from app.main import app
from app.models.place import Place
from app.models.guide_content import GuideContent
from app.models.user import User
from app.models.admin import Journey, JourneyStop
from app.services import source_metadata
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

# Explicit test-only source metadata. Production never uses this provider stub.
def browser_source_fixture(endpoint, params):
    if 'commons.wikimedia.org' in endpoint:
        return {'query': {'pages': {'2': {'title': 'File:Browser fixture.jpg', 'imageinfo': [{'thumburl': 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Browser_fixture.jpg', 'extmetadata': {'LicenseShortName': {'value': 'CC0'}, 'Artist': {'value': 'Browser fixture author'}}}]}}}}
    return {'query': {'pages': {'9900001': {'pageid': 9900001, 'ns': 0, 'title': 'URL Import Browser Fixture', 'extract': 'Explicit local browser test metadata.', 'coordinates': [{'lat': 11.5, 'lon': 106.7, 'globe': 'earth', 'primary': ''}], 'pageimage': 'Browser fixture.jpg'}}}}
source_metadata.fetch_json = browser_source_fixture

from alembic import command
from alembic.config import Config
with engine.begin() as connection:
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    config.set_main_option('script_location', str(Path(__file__).resolve().parents[1] / 'alembic'))
    config.attributes['connection'] = connection
    command.upgrade(config, 'head')
with SessionLocal() as db:
    db.add(User(email="admin@e2e.example.com", password_hash=hash_password("TestPassword123!"), full_name="Browser Test Admin", role="admin", language="vi"))
    place = Place(name="Browser Test Museum", description="Verified place description", latitude=10.7764, longitude=106.6993, address="Test address", category="Văn hóa")
    db.add(place)
    db.flush()
    for language in ("vi", "en", "fr", "ja"):
        db.add(GuideContent(place_id=place.id, language_code=language, title="Test guide", content=f"Verified test narration in {language}."))
    extras = []
    for index in range(30):
        point = Place(name=f'Journey Admin fixture {index:03}', latitude=11.1+index/1000, longitude=106.6993, publication_status='published', category='Văn hóa', address='Explicit browser fixture address')
        db.add(point); db.flush(); extras.append(point)
    for language in ('vi', 'en', 'fr', 'ja'):
        db.add(GuideContent(place_id=extras[0].id, language_code=language, title='Second stop fixture', content=f'Ordered second stop narration in {language}.'))
    journey = Journey(name='Browser Journey Fixture', description='Two ordered PostgreSQL test stops.')
    db.add(journey); db.flush()
    db.add_all([JourneyStop(journey_id=journey.id, place_id=place.id, position=0), JourneyStop(journey_id=journey.id, place_id=extras[0].id, position=1)])
    db.commit()

if __name__ == "__main__":
    import uvicorn
    try:
        uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")
    finally:
        engine.dispose()
        runtime.cleanup()
