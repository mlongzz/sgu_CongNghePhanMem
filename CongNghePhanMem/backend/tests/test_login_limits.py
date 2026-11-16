import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


@pytest.fixture
def client(db_session):
    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_login_password_length_is_limited(client):
    ok = client.post("/auth/login", json={"email": "nobody@example.com", "password": "p" * 128})
    assert ok.status_code == 401
    too_long = client.post("/auth/login", json={"email": "nobody@example.com", "password": "p" * 129})
    assert too_long.status_code == 422
