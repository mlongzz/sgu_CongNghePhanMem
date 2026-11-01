import copy
from test_admin import client, admin_headers  # noqa: F401
from test_url_import import providers, COMMONS  # noqa: F401
from app.models.place import Place
from app.services import source_metadata as source


def test_existing_place_photo_discovery_stays_pending_and_is_idempotent(
    client, admin_headers, providers, db_session, monkeypatch, tmp_path
):
    from test_media_and_account import png
    from app.services import safe_image_download
    from app.routers import media
    monkeypatch.setattr(safe_image_download,"download_image",lambda url:png())
    monkeypatch.setattr(media,"UPLOAD_DIR",str(tmp_path))
    place = Place(
        name="Explicit URL import fixture",
        latitude=10,
        longitude=106,
        source="wikipedia",
        source_id="vi:9001",
        source_url="https://vi.wikipedia.org/?curid=9001",
        publication_status="draft",
    )
    db_session.add(place)
    db_session.commit()
    path = f"/admin/places/{place.id}/images/discover"
    assert client.post(path).status_code == 401
    assert client.post(path, headers=admin_headers).json()["added"] == 1
    assert client.post(path, headers=admin_headers).json()["added"] == 0
    rows = client.get(f"/admin/places/{place.id}/images", headers=admin_headers).json()
    assert len(rows) == 1 and rows[0]["status"] == "pending"
    assert rows[0]["url"].startswith("/media/") and rows[0]["thumbnail_url"].startswith("/media/")
    assert rows[0]["source_url"].startswith("https://commons.wikimedia.org/")
    db_session.refresh(place)
    assert place.image_url is None and place.publication_status == "draft"
    place.latitude = 30
    db_session.commit()
    assert client.post(path, headers=admin_headers).status_code == 422


def test_wikidata_and_osm_metadata_use_exact_source_ids_and_verified_image_relation(
    monkeypatch,
):
    def provider(endpoint, params):
        if "commons.wikimedia.org" in endpoint:
            return copy.deepcopy(COMMONS)
        if "wikidata.org" in endpoint:
            return {
                "entities": {
                    "Q42": {
                        "labels": {"en": {"value": "Wikidata source fixture"}},
                        "claims": {
                            "P625": [
                                {
                                    "mainsnak": {
                                        "datavalue": {
                                            "value": {
                                                "latitude": 10,
                                                "longitude": 106,
                                                "globe": "http://www.wikidata.org/entity/Q2",
                                            }
                                        }
                                    }
                                }
                            ],
                            "P18": [
                                {"mainsnak": {"datavalue": {"value": "Fixture.jpg"}}}
                            ],
                        },
                    }
                }
            }
        return {
            "elements": [
                {
                    "type": "node",
                    "id": 42,
                    "lat": 10,
                    "lon": 106,
                    "tags": {
                        "name": "OSM source fixture",
                        "wikidata": "Q42",
                        "tourism": "museum",
                    },
                }
            ]
        }

    monkeypatch.setattr(source, "fetch_json", provider)
    metadata, image = source.resolve_metadata("https://www.wikidata.org/wiki/Q42")
    assert (
        metadata["source_id"] == "Q42"
        and metadata["source_license"] == "CC0"
        and image["license"] == "CC BY-SA 4.0"
    )
    metadata, image = source.resolve_metadata("https://www.openstreetmap.org/node/42")
    assert (
        metadata["source_id"] == "node/42"
        and metadata["source_license"] == "ODbL-1.0"
        and image["attribution"] == "Fixture author"
    )


def test_health_checks_are_public_and_do_not_disclose_database_failure_details(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ready"}
    from app.main import app
    from app.database import get_db

    previous = app.dependency_overrides[get_db]

    class Unavailable:
        def execute(self, *args):
            raise RuntimeError("private connection detail fixture")

    app.dependency_overrides[get_db] = lambda: Unavailable()
    try:
        response = client.get("/health/ready")
        assert response.status_code == 503 and response.json() == {
            "status": "unavailable"
        }
        assert "private" not in response.text
    finally:
        app.dependency_overrides[get_db] = previous
