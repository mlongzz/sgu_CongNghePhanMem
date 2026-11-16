import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import get_db
from app.main import app
from app.models.admin import AuditLog
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token


@pytest.fixture
def client(db_session):
    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def headers(db_session):
    user = User(email="admin@example.test", password_hash="unused", full_name="Admin", role="admin")
    db_session.add(user)
    db_session.commit()
    return {"Authorization": "Bearer " + create_access_token(user.id)}


@pytest.fixture
def guide(db_session):
    place = Place(name="Museum", latitude=10.77, longitude=106.7, publication_status="published")
    db_session.add(place)
    db_session.flush()
    row = GuideContent(place_id=place.id, language_code="vi", title="Bao tang", content="Noi dung", publication_status="published")
    db_session.add(row)
    db_session.commit()
    return row


def audit_actions(db_session):
    return [a.action for a in db_session.query(AuditLog).filter(AuditLog.resource == "guides").order_by(AuditLog.id)]


def test_soft_delete_keeps_row_and_hides_from_default_list(client, headers, db_session, guide):
    assert client.delete(f"/admin/guides/{guide.id}", headers=headers).status_code == 204
    assert client.delete(f"/admin/guides/{guide.id}", headers=headers).status_code == 204
    db_session.expire_all()
    row = db_session.get(GuideContent, guide.id)
    assert row.deleted_at is not None
    assert row.publication_status == "draft"
    assert client.get("/admin/guides", headers=headers).json()["total"] == 0
    listed = client.get("/admin/guides?include_deleted=true", headers=headers).json()
    assert listed["total"] == 1
    assert listed["items"][0]["deleted_at"] is not None
    assert audit_actions(db_session)[0] == "soft_delete"


def test_restore_returns_draft_guide(client, headers, db_session, guide):
    client.delete(f"/admin/guides/{guide.id}", headers=headers)
    restored = client.post(f"/admin/guides/{guide.id}/restore", headers=headers)
    assert restored.status_code == 200
    body = restored.json()
    assert body["id"] == guide.id
    assert body["deleted_at"] is None
    assert body["publication_status"] == "draft"
    assert client.get("/admin/guides", headers=headers).json()["items"][0]["deleted_at"] is None
    assert audit_actions(db_session) == ["soft_delete", "restore"]
    assert client.post("/admin/guides/9999/restore", headers=headers).status_code == 404


def test_put_on_deleted_guide_is_conflict(client, headers, guide):
    client.delete(f"/admin/guides/{guide.id}", headers=headers)
    response = client.put(f"/admin/places/{guide.place_id}/guide-content/vi", headers=headers, json={"title": "New"})
    assert response.status_code == 409
    assert response.json()["detail"] == "Restore this guide before editing"
    client.post(f"/admin/guides/{guide.id}/restore", headers=headers)
    assert client.put(f"/admin/places/{guide.place_id}/guide-content/vi", headers=headers, json={"title": "New"}).status_code == 200


def test_overview_counts_only_live_guides(client, headers, db_session, guide):
    assert client.get("/admin/overview", headers=headers).json()["kpis"]["guides"] == 1
    client.delete(f"/admin/guides/{guide.id}", headers=headers)
    assert client.get("/admin/overview", headers=headers).json()["kpis"]["guides"] == 0
    assert db_session.execute(text("SELECT COUNT(*) FROM guide_contents")).scalar() == 1


def test_deleted_guide_hidden_from_visitors(client, headers, db_session, guide):
    place_id = guide.place_id
    assert client.get(f"/places/{place_id}/guide-content?language=vi").status_code == 200
    assert client.get(f"/places/{place_id}/guide-content/languages").json() == ["vi"]
    assert client.get(f"/places/{place_id}").json()["description_translations"] == {"vi": "Noi dung"}
    client.delete(f"/admin/guides/{guide.id}", headers=headers)
    assert client.get(f"/places/{place_id}/guide-content?language=vi").status_code == 404
    assert client.get(f"/places/{place_id}/guide-content/languages").json() == []
    assert client.get(f"/places/{place_id}").json()["description_translations"] == {}
    assert client.get("/places").json()[0]["description_translations"] == {}


def test_legacy_guide_routes_reject_deleted_guide(client, headers, guide):
    client.delete(f"/admin/guides/{guide.id}", headers=headers)
    path = f"/places/{guide.place_id}/guide-content"
    assert client.put(f"{path}/vi", headers=headers, json={"title": "New"}).status_code == 409
    assert client.post(f"{path}/vi/translate", headers=headers, json={"target_language": "en"}).status_code == 404
