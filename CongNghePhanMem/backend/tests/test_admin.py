from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.audio_session import AudioGuideSession
from app.models.user import User
from app.routers.auth import create_access_token


@pytest.fixture
def client(db_session):
    # Exercise real FK cascades in the isolated SQLite test DB too.
    if db_session.get_bind().dialect.name == "sqlite":
        db_session.execute(__import__('sqlalchemy').text('PRAGMA foreign_keys=ON'))
    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def admin_headers(db_session):
    user = User(email="admin@example.test", password_hash="unused", full_name="Admin", role="admin")
    db_session.add(user)
    db_session.commit()
    return {"Authorization": "Bearer " + create_access_token(user.id)}


@pytest.mark.parametrize("path", ["overview", "users", "places", "journeys", "guides", "playback", "audit-logs", "settings", "status"])
def test_admin_reads_require_jwt(client, path):
    assert client.get('/admin/' + path).status_code == 401


def test_normal_user_cannot_escalate(client, db_session):
    response = client.post('/users', json={"email": "normal@example.com", "password": "TestPassword123!", "full_name": "Member", "role": "admin"})
    assert response.status_code == 201
    assert response.json()['role'] == 'user'
    headers = {"Authorization": "Bearer " + create_access_token(response.json()['id'])}
    assert client.get('/admin/overview', headers=headers).status_code == 403
    assert client.post('/admin/places', headers=headers, json={"name": "Denied", "latitude": 0, "longitude": 0}).status_code == 403


def test_invalid_jwt_claims_are_rejected(client, admin_headers):
    import jwt
    from app.config import SECRET_KEY, ALGORITHM
    missing_exp = jwt.encode({"sub": "1", "type": "access"}, SECRET_KEY, algorithm=ALGORITHM)
    assert client.get('/admin/me', headers={"Authorization": 'Bearer ' + missing_exp}).status_code == 401
    from app.routers.auth import create_refresh_token
    assert client.get('/admin/me', headers={"Authorization": 'Bearer ' + create_refresh_token(1)}).status_code == 401


def test_admin_crud_shared_api_and_audit(client, admin_headers):
    h = admin_headers
    assert client.get('/admin/overview', headers=h).json()['kpis']['plays'] == 0
    assert client.post('/admin/places', headers=h, json={"name": "Invalid", "latitude": 91, "longitude": 0}).status_code == 422
    place = client.post('/admin/places', headers=h, json={"name": "Museum", "latitude": 16.4, "longitude": 107.5})
    assert place.status_code == 201
    pid = place.json()['id']
    assert client.get(f'/places/{pid}').json()['name'] == 'Museum'
    assert client.put(f'/admin/places/{pid}', headers=h, json={"name": "Updated"}).status_code == 200
    assert client.get('/admin/places?q=Updated&page_size=1', headers=h).json()['total'] == 1
    assert client.get('/admin/places?page=0', headers=h).status_code == 422
    guide = {"title": "Title", "content": "Verified script", "language_code": "en"}
    result = client.put(f'/admin/places/{pid}/guide-content/en', headers=h, json=guide)
    assert result.status_code == 200
    assert client.get(f'/places/{pid}/guide-content?language=en').json()['content'] == 'Verified script'
    assert client.put(f'/admin/places/{pid}/guide-content/vi', headers=h, json=guide).status_code == 422
    journey = client.post('/admin/journeys', headers=h, json={"name": "Walk", "place_ids": [pid]})
    assert journey.status_code == 201
    jid = journey.json()['id']
    assert client.get(f'/journeys/{jid}').json()['place_ids'] == [pid]
    assert client.post('/admin/journeys', headers=h, json={"name": "Wrong", "place_ids": [9999]}).status_code == 422
    assert client.post('/admin/journeys', headers=h, json={"name": "Duplicate", "place_ids": [pid, pid]}).status_code == 422
    assert client.put(f'/admin/journeys/{jid}', headers=h, json={"name": "Empty route", "place_ids": []}).json()['place_ids'] == []
    assert client.put('/admin/settings', headers=h, json={"site_name": "Guide", "default_language": "vi", "nearby_radius_km": 5}).status_code == 200
    assert client.get('/admin/settings', headers=h).json()['nearby_radius_km'] == 5
    logs = client.get('/admin/audit-logs', headers=h).json()
    assert logs['total'] >= 5
    assert client.delete(f'/admin/journeys/{jid}', headers=h).status_code == 204
    assert client.delete(f'/admin/places/{pid}', headers=h).status_code == 204
    assert client.get(f'/places/{pid}').status_code == 404
    assert client.get('/admin/guides', headers=h).json()['total'] == 0


def test_user_management_rechecks_database_role(client, admin_headers):
    h = admin_headers
    created = client.post('/admin/users', headers=h, json={"email": "staff@example.com", "password": "TestPassword123!", "full_name": "Staff"})
    assert created.status_code == 201
    uid = created.json()['id']
    assert 'password_hash' not in created.json()
    staff = {"Authorization": "Bearer " + create_access_token(uid)}
    assert client.get('/admin/me', headers=staff).status_code == 403
    assert client.patch(f'/admin/users/{uid}/role', headers=h, json={"role": "admin"}).status_code == 200
    assert client.get('/admin/me', headers=staff).status_code == 200
    assert client.patch(f'/admin/users/{uid}/role', headers=h, json={"role": "user"}).status_code == 200
    assert client.get('/admin/me', headers=staff).status_code == 403
    assert client.post('/admin/users', headers=h, json={"email": "staff@example.com", "password": "TestPassword123!", "full_name": "Duplicate"}).status_code == 409
    me = client.get('/admin/me', headers=h).json()['user_id']
    assert client.delete(f'/admin/users/{me}', headers=h).status_code == 409
    assert client.delete(f'/admin/users/{uid}', headers=h).status_code == 204


def test_analytics_aggregate_real_sessions_and_filter_dates(client, admin_headers, db_session):
    h = admin_headers
    pid = client.post('/admin/places', headers=h, json={"name": "POI", "latitude": 0, "longitude": 0}).json()['id']
    uid = client.get('/admin/me', headers=h).json()['user_id']
    db_session.add_all([AudioGuideSession(user_id=uid, place_id=pid, language_code='en', completed=True, progress=1,
                                         started_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
                        AudioGuideSession(user_id=uid, place_id=pid, language_code='vi',
                                         started_at=datetime(2025, 1, 2, tzinfo=timezone.utc))])
    db_session.commit()
    for period, label in [('day', '2026-01-02'), ('month', '2026-01'), ('year', '2026')]:
        response = client.get(f'/admin/overview?period={period}&start=2026-01-01&end=2026-12-31', headers=h)
        assert response.status_code == 200
        data = response.json()
        assert data['kpis']['plays'] == 1
        assert data['kpis']['completed'] == 1
        assert data['series'] == [{"label": label, "count": 1}]
        assert data['languages'] == [{"language": "en", "count": 1}]
        assert data['popular'][0]['name'] == 'POI'
    assert client.get('/admin/overview?start=2026-12-01&end=2026-01-01', headers=h).status_code == 422
