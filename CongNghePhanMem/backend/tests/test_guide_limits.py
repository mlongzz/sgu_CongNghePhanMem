import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
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
    db_session.add(Place(name="Museum", latitude=10.77, longitude=106.7, publication_status="published"))
    db_session.commit()
    return {"Authorization": "Bearer " + create_access_token(user.id)}


def test_guide_content_length_is_limited(client, headers):
    ok = {"title": "T", "content": "x" * 20000, "publication_status": "draft"}
    too_long = {**ok, "content": "x" * 20001}
    assert client.put("/admin/places/1/guide-content/vi", headers=headers, json=ok).status_code == 200
    assert client.put("/admin/places/1/guide-content/vi", headers=headers, json=too_long).status_code == 422
    assert client.put("/admin/places/1/guide-content/en", headers=headers, json=too_long).status_code == 422
    assert client.post("/places/1/guide-content", headers=headers, json={**too_long, "language_code": "fr"}).status_code == 422
    assert client.put("/places/1/guide-content/vi", headers=headers, json={"content": "x" * 20001}).status_code == 422
