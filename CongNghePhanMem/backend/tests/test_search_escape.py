import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token
from app.services.search_utils import escape_like

BS = chr(92)


@pytest.fixture
def client(db_session):
    db_session.add_all([
        Place(name="Plain Museum", latitude=10.7, longitude=106.7, publication_status="published"),
        Place(name="100% Pure", latitude=10.7, longitude=106.7, publication_status="published"),
        Place(name="snake_case", latitude=10.7, longitude=106.7, publication_status="published"),
        Place(name="snakeXcase", latitude=10.7, longitude=106.7, publication_status="published"),
        Place(name="back" + BS + "slash", latitude=10.7, longitude=106.7, publication_status="published"),
    ])
    db_session.commit()

    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def names(client, q):
    return sorted(row["name"] for row in client.get("/places/search", params={"q": q}).json())


def test_escape_like_escapes_wildcards():
    assert escape_like("a%b_c" + BS + "d") == "a" + BS + "%b" + BS + "_c" + BS + BS + "d"


def test_public_search_treats_wildcards_literally(client):
    assert names(client, "%") == ["100% Pure"]
    assert names(client, "_") == ["snake_case"]
    assert names(client, "\\") == ["back" + BS + "slash"]
    assert names(client, "snake_c") == ["snake_case"]
    assert names(client, "museum") == ["Plain Museum"]


def test_public_search_query_length_is_limited(client):
    assert client.get("/places/search", params={"q": "a" * 100}).status_code == 200
    assert client.get("/places/search", params={"q": "a" * 101}).status_code == 422


def test_admin_search_treats_wildcards_literally(client, db_session):
    admin = User(email="admin@example.test", password_hash="unused", full_name="Admin", role="admin")
    db_session.add(admin)
    db_session.commit()
    headers = {"Authorization": "Bearer " + create_access_token(admin.id)}
    items = client.get("/admin/places", params={"q": "%"}, headers=headers).json()["items"]
    assert [row["name"] for row in items] == ["100% Pure"]
    assert client.get("/admin/users", params={"q": "_"}, headers=headers).json()["total"] == 0
