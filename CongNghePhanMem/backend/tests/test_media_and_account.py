from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.database import get_db
from app.main import app
from app.models.user import User
from app.routers.auth import create_access_token
from app.routers import media
from app.services import media_service


@pytest.fixture
def client(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(media, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(media_service, "UPLOAD_DIR", str(tmp_path))
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def headers(db_session, role="user", email="member@example.com"):
    user = User(email=email, password_hash="unused", full_name="Member", role=role)
    db_session.add(user)
    db_session.commit()
    return {"Authorization": "Bearer " + create_access_token(user.id)}


def png():
    output = BytesIO()
    Image.new("RGB", (16, 16), "teal").save(output, "PNG")
    return output.getvalue()


def test_image_upload_replace_remove_and_audit(client, db_session, tmp_path):
    admin = headers(db_session, "admin")
    place = client.post('/admin/places', headers=admin, json={"name": "Museum", "latitude": 1, "longitude": 2}).json()
    path = f'/admin/places/{place["id"]}/image'
    upload = client.post(path, headers=admin, content=png())
    assert upload.status_code == 200
    url = upload.json()['image_url']
    assert client.get(f'/places/{place["id"]}').json()['image_url'] == url
    image = client.get(url)
    assert image.status_code == 200
    assert image.headers['content-type'] == 'image/jpeg'
    assert image.headers['x-content-type-options'] == 'nosniff'
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.size == (16, 16)
        assert not decoded.getexif()
    replacement = client.post(path, headers=admin, content=png()).json()['image_url']
    assert replacement != url
    assert client.get(url).status_code == 404
    assert len(list(tmp_path.iterdir())) == 1
    assert client.delete(path, headers=admin).json()['image_url'] is None
    assert client.get(replacement).status_code == 404
    actions = [r['action'] for r in client.get('/admin/audit-logs', headers=admin).json()['items']]
    assert 'upload_image' in actions and 'delete_image' in actions


def test_images_require_admin_and_reject_unsafe_files(client, db_session, monkeypatch):
    admin = headers(db_session, "admin")
    user = headers(db_session, email="other@example.com")
    pid = client.post('/admin/places', headers=admin, json={"name": "Museum", "latitude": 0, "longitude": 0}).json()['id']
    path = f'/admin/places/{pid}/image'
    assert client.post(path, content=png()).status_code == 401
    assert client.post(path, headers=user, content=png()).status_code == 403
    assert client.delete(path, headers=user).status_code == 403
    assert client.post(path, headers=admin, content=b'<svg onload="alert(1)"/>').status_code == 415
    assert client.post(path, headers=admin, content=b'').status_code == 415
    monkeypatch.setattr(media, 'MAX_BYTES', 10)
    assert client.post(path, headers=admin, content=png()).status_code == 413
    assert client.get('/media/not-an-image.jpg').status_code == 404


def test_image_pixel_limit_and_unknown_place(client, db_session, monkeypatch):
    admin = headers(db_session, "admin")
    pid = client.post('/admin/places', headers=admin, json={"name": "Museum", "latitude": 0, "longitude": 0}).json()['id']
    monkeypatch.setattr(media, 'MAX_PIXELS', 100)
    assert client.post(f'/admin/places/{pid}/image', headers=admin, content=png()).status_code == 413
    assert client.post('/admin/places/999999/image', headers=admin, content=png()).status_code == 404


def test_own_review_and_profile_stay_scoped_to_user(client, db_session):
    admin = headers(db_session, "admin")
    user = headers(db_session, email="reviewer@example.com")
    pid = client.post('/admin/places', headers=admin, json={"name": "Museum", "latitude": 0, "longitude": 0}).json()['id']
    path = f'/places/{pid}/reviews'
    assert client.get(path + '/me').status_code == 401
    assert client.get(path + '/me', headers=user).json() is None
    created = client.post(path, headers=user, json={"rating": 4, "comment": "Beautiful"}).json()
    assert client.get(path + '/me', headers=user).json()['id'] == created['id']
    assert client.get(path + '/me', headers=admin).json() is None
    assert client.put(path + f'/{created["id"]}', headers=admin, json={"rating": 1}).status_code == 403
    current = client.get('/users/me', headers=user).json()
    updated = client.put(f'/users/{current["id"]}', headers=user, json={"full_name": "New name", "language": "ja", "role": "admin"})
    assert updated.status_code == 200
    assert updated.json()['full_name'] == 'New name'
    assert updated.json()['language'] == 'ja'
    assert updated.json()['role'] == 'user'


def test_shared_image_is_kept_until_last_place_releases_it(client, db_session, tmp_path):
    admin = headers(db_session, 'admin')
    ids = [client.post('/admin/places', headers=admin, json={"name": name, "latitude": 0, "longitude": 0}).json()['id'] for name in ('First', 'Second')]
    url = client.post(f'/admin/places/{ids[0]}/image', headers=admin, content=png()).json()['image_url']
    client.put(f'/admin/places/{ids[1]}', headers=admin, json={'image_url': url})
    client.delete(f'/admin/places/{ids[0]}', headers=admin)
    assert client.get(url).status_code == 200
    client.put(f'/places/{ids[1]}', headers=admin, json={'image_url': None})
    assert client.get(url).status_code == 404
    assert not list(tmp_path.iterdir())
