"""Reviewed imports use explicit source fixtures and isolated test databases."""
import json

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.admin import AdminSetting, AuditLog
from app.models.place import Place
from app.models.guide_content import GuideContent
from app.models.user import User
from app.routers.auth import create_access_token
from app.services import wikipedia_catalog_service as service


def fixture_place(page_id=123, **changes):
    return {"source": "wikipedia", "source_id": f"vi:{page_id}", "name": f"Fixture museum {page_id}",
            "latitude": 10.75, "longitude": 106.65, "category": "museum",
            "source_url": f"https://vi.wikipedia.org/?curid={page_id}", "source_revision_id": 456,
            "source_revision_url": "https://vi.wikipedia.org/w/index.php?oldid=456",
            "license": "CC-BY-SA-4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
            "attribution": "Wikipedia contributors", "fetched_at": "2026-10-20T00:00:00Z",
            "coordinate_role": "primary_article_coordinate_not_verified_entrance",
            "publication_status": "draft", "review_status": "pending_admin_review", **changes}


@pytest.fixture
def api(db_session, monkeypatch, tmp_path):
    bundle = tmp_path / "review.json"
    bundle.write_text(json.dumps({"bundle_id": service.BUNDLE_ID, "places": [fixture_place(), fixture_place(789)]}), encoding="utf-8")
    monkeypatch.setattr(service, "CATALOG_PATH", bundle)
    actor = User(email="wiki-admin@example.test", full_name="Wiki reviewer", password_hash="unused", role="admin")
    user = User(email="wiki-user@example.test", full_name="Wiki reader", password_hash="unused", role="user")
    db_session.add_all([actor, user])
    db_session.commit()
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app), {"Authorization": "Bearer " + create_access_token(actor.id)}, user.id, bundle
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_preview_import_draft_provenance_repeat_and_rbac(api, db_session):
    client, headers, user_id, _ = api
    url = "/admin/catalog/hcmc-discovery"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer " + create_access_token(user_id)}).status_code == 403
    plan = client.get(url, headers=headers).json()
    assert plan["places_to_create"] == 2 and plan["guides_to_create"] == 0
    assert db_session.query(Place).count() == 0
    selection = {"source_ids": ["vi:123"]}
    preview = client.post(url + "/preview", headers=headers, json=selection).json()
    result = client.post(url + "/import", headers=headers, json={**selection, "preview_token": preview["preview_token"]})
    assert result.status_code == 200
    place = db_session.query(Place).one()
    assert (place.source, place.source_id, place.publication_status) == ("wikipedia", "vi:123", "draft")
    assert place.description is None and place.image_url is None
    assert place.source_license == "CC-BY-SA-4.0"
    assert client.get("/places").json() == [] and db_session.query(GuideContent).count() == 0
    assert db_session.query(AuditLog).filter_by(resource="wikipedia").count() == 1
    evidence = db_session.get(AdminSetting, service.BUNDLE_ID).value["vi:123"]["snapshot"]
    assert evidence["source_revision_id"] == 456 and evidence["coordinate_role"] == "primary_article_coordinate_not_verified_entrance"
    place.description = "Preserve edited narration intro"
    db_session.commit()
    repeated = client.post(url + "/preview", headers=headers, json=selection).json()
    assert repeated["existing"] == 1
    assert client.post(url + "/import", headers=headers, json={**selection, "preview_token": repeated["preview_token"]}).status_code == 200
    assert db_session.query(Place).count() == 1 and place.description == "Preserve edited narration intro"


def test_conflicts_block_every_row_selection_can_exclude_conflict_and_stale_bundle_is_rejected(api, db_session):
    client, headers, _, bundle = api
    url = "/admin/catalog/hcmc-discovery"
    db_session.add(Place(name="Fixture museum 123", latitude=10.75, longitude=106.65))
    db_session.commit()
    all_rows = {"source_ids": ["vi:123", "vi:789"]}
    preview = client.post(url + "/preview", headers=headers, json=all_rows).json()
    assert preview["conflicts"] == 1 and preview["places_to_create"] == 1
    assert client.post(url + "/import", headers=headers, json={**all_rows, "preview_token": preview["preview_token"]}).status_code == 409
    assert db_session.query(Place).count() == 1 and db_session.get(AdminSetting, service.BUNDLE_ID) is None
    selection = {"source_ids": ["vi:789"]}
    preview = client.post(url + "/preview", headers=headers, json=selection).json()
    changed = json.loads(bundle.read_text(encoding="utf-8"))
    changed["places"][1]["source_revision_id"] = 457
    changed["places"][1]["source_revision_url"] = "https://vi.wikipedia.org/w/index.php?oldid=457"
    bundle.write_text(json.dumps(changed), encoding="utf-8")
    assert client.post(url + "/import", headers=headers, json={**selection, "preview_token": preview["preview_token"]}).status_code == 409
    current = client.post(url + "/preview", headers=headers, json=selection).json()
    assert client.post(url + "/import", headers=headers, json={**selection, "preview_token": current["preview_token"]}).status_code == 200
    assert db_session.query(Place).count() == 2


@pytest.mark.parametrize("selection", [[], ["vi:123", "vi:123"], ["en:999999"], ["vi:123", "https://attacker.test"]])
def test_invalid_selections_cannot_apply(api, selection):
    client, headers, _, _ = api
    assert client.post("/admin/catalog/hcmc-discovery/preview", headers=headers, json={"source_ids": selection}).status_code == 422


@pytest.mark.parametrize("changes", [{"publication_status": "published"}, {"latitude": float("nan")},
    {"source_url": "https://attacker.test"}, {"source_revision_url": "https://vi.wikipedia.org/w/index.php?oldid=999"}])
def test_untrusted_or_inconsistent_source_metadata_is_rejected(changes):
    with pytest.raises(ValueError):
        service.WikipediaReviewPlace.model_validate(fixture_place(**changes))


def test_checked_in_bundle_has_primary_source_metadata_and_unique_identities():
    bundle, places = service.load_review_catalog()
    assert bundle["bundle_id"] == service.BUNDLE_ID
    assert 30 <= len(places) <= 50
    assert {place.source_id.split(":")[0] for place in places} <= {"vi", "en"}


def test_evidenced_aliases_detect_english_and_vietnamese_legacy_duplicates(db_session):
    db_session.add_all([Place(name="Bảo tàng Chứng tích Chiến tranh", latitude=10.779475, longitude=106.692132),
                        Place(name="Bưu điện Trung tâm Sài Gòn", latitude=10.779884, longitude=106.699943)])
    db_session.commit()
    plan = service.discovery_plan(db_session, ["en:9821917", "vi:80559"])
    assert plan["conflicts"] == 2 and plan["places_to_create"] == 0
