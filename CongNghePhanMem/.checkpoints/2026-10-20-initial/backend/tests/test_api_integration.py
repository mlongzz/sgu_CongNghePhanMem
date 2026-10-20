from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.database import get_db
from app.main import app
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.config import SECRET_KEY, ALGORITHM


@pytest.fixture
def api_client(db_session: Session) -> Iterator[TestClient]:
    previous_overrides = app.dependency_overrides.copy()

    def override_get_db() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        # Avoid the app lifespan here so the test database stays isolated from the developer DB.
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


def register_and_login(client: TestClient, email: str = "api-user@example.com") -> tuple[int, str, str]:
    created = client.post(
        "/users",
        json={
            "email": email,
            "password": "TestPassword123!",
            "full_name": "API User",
            "language": "vi",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    login = client.post(
        "/auth/login",
        json={"email": email, "password": "TestPassword123!"},
    )
    assert login.status_code == 200
    return user_id, login.json()["access_token"], login.json()["refresh_token"]


def test_auth_profile_and_authorization_flow(api_client: TestClient) -> None:
    user_id, access_token, refresh_token = register_and_login(api_client)

    assert api_client.get("/users/me").status_code == 401
    refreshed = api_client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200
    assert api_client.post("/auth/refresh", json={"refresh_token": access_token}).status_code == 401
    headers = {"Authorization": f"Bearer {access_token}"}
    profile = api_client.get("/users/me", headers=headers)
    assert profile.status_code == 200
    assert profile.json()["id"] == user_id
    assert "password_hash" not in profile.json()
    assert api_client.get(f"/users/{user_id + 1}", headers=headers).status_code == 403
    assert api_client.put(
        f"/users/{user_id + 1}",
        json={"full_name": "Someone else"},
        headers=headers,
    ).status_code == 403
    assert api_client.get("/admin/me", headers=headers).status_code == 403


@pytest.mark.parametrize("kind", ["missing", "basic", "expired", "signature", "algorithm", "refresh", "no_exp", "no_sub", "no_type", "subject", "unknown_user"])
def test_users_me_rejects_invalid_credentials_and_keeps_cors(api_client: TestClient, kind: str):
    user_id, access, refresh = register_and_login(api_client)
    payload = {"sub": str(user_id), "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}
    secret, algorithm = SECRET_KEY, ALGORITHM
    if kind == "expired": payload["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    if kind == "signature": secret = "wrong-test-key-that-must-not-validate"
    if kind == "algorithm": algorithm = "HS512"
    if kind.startswith("no_"): payload.pop(kind[3:])
    if kind == "subject": payload["sub"] = "not-an-integer"
    if kind == "unknown_user": payload["sub"] = str(user_id + 9999)
    token = refresh if kind == "refresh" else jwt.encode(payload, secret, algorithm=algorithm)
    headers = {"Origin": "http://localhost:8081"}
    if kind != "missing": headers["Authorization"] = "Basic invalid" if kind == "basic" else f"Bearer {token}"
    response = api_client.get("/users/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
    renewed = api_client.post("/auth/refresh", json={"refresh_token": refresh})
    assert renewed.status_code == 200
    assert api_client.get("/users/me", headers={"Authorization": "Bearer " + renewed.json()["access_token"]}).json()["id"] == user_id


def test_place_guide_favorite_history_audio_and_review_routes(
    api_client: TestClient,
    db_session: Session,
) -> None:
    place = Place(name="Integration Museum", latitude=16.46, longitude=107.59)
    db_session.add(place)
    db_session.flush()
    db_session.add(
        GuideContent(
            place_id=place.id,
            language_code="vi",
            title="Câu chuyện bảo tàng",
            content="Một bài thuyết minh tích hợp để kiểm tra API.",
        )
    )
    db_session.commit()
    user_id, access_token, _refresh_token = register_and_login(api_client)
    headers = {"Authorization": f"Bearer {access_token}"}

    assert api_client.get("/places?limit=0").status_code == 422
    assert api_client.get(f"/places/search?q=Integration").json()[0]["id"] == place.id
    assert api_client.get(
        f"/places/nearby?latitude=16.46&longitude=107.59&radius_km=1"
    ).json()[0]["id"] == place.id
    guide = api_client.get(f"/places/{place.id}/guide-content?language=vi")
    assert guide.status_code == 200
    assert guide.json()["language_code"] == "vi"

    favorite = api_client.post("/favorites", json={"place_id": place.id}, headers=headers)
    assert favorite.status_code == 201
    assert api_client.get("/favorites", headers=headers).json()[0]["place_id"] == place.id

    history = api_client.post(f"/history/{place.id}", headers=headers)
    assert history.status_code == 201
    assert api_client.get("/history", headers=headers).json()[0]["place_id"] == place.id

    session = api_client.post(
        "/audio-sessions",
        json={"place_id": place.id, "language_code": "VI"},
        headers=headers,
    )
    assert session.status_code == 201
    session_id = session.json()["id"]
    progress = api_client.patch(
        f"/audio-sessions/{session_id}",
        json={"progress": 0.5},
        headers=headers,
    )
    assert progress.status_code == 200
    assert progress.json()["user_id"] == user_id
    assert progress.json()["progress"] == 0.5

    review = api_client.post(
        f"/places/{place.id}/reviews",
        json={"rating": 5, "comment": "Great audio guide"},
        headers=headers,
    )
    assert review.status_code == 201
    summary = api_client.get(f"/places/{place.id}/reviews/summary")
    assert summary.status_code == 200
    assert summary.json()["average_rating"] == 5.0


def test_cors_preflight_for_frontend_origin(api_client: TestClient) -> None:
    response = api_client.options(
        "/places",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
