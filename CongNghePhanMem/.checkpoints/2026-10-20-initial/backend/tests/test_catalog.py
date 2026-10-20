import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models.admin import AuditLog
from app.models.guide_content import GuideContent
from app.models.place import Place
from app.models.user import User
from app.routers.auth import create_access_token
from app.services.catalog_service import load_catalog


@pytest.fixture
def client(db_session):
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = lambda: db_session
    try: yield TestClient(app)
    finally:
        app.dependency_overrides.clear(); app.dependency_overrides.update(previous)


def headers(db, role):
    actor = User(email=role + '@catalog.test', full_name=role, role=role, password_hash='unused')
    db.add(actor); db.commit()
    return {'Authorization': 'Bearer ' + create_access_token(actor.id)}


def test_catalog_import_requires_real_admin_role(client, db_session):
    user_headers = headers(db_session, 'user')
    for path, method in [('/admin/catalog/hcmc', 'get'), ('/admin/catalog/hcmc/import', 'post')]:
        assert getattr(client, method)(path).status_code == 401
        assert getattr(client, method)(path, headers=user_headers).status_code == 403
    assert db_session.query(Place).count() == 0


def test_additive_import_is_atomic_audited_idempotent_and_available_to_public_nearby(client, db_session):
    h = headers(db_session, 'admin')
    preview = client.get('/admin/catalog/hcmc', headers=h).json()
    assert preview['places_to_create'] == 9 and preview['guides_to_create'] == 36
    assert db_session.query(Place).count() == 0
    result = client.post('/admin/catalog/hcmc/import', headers=h)
    assert result.status_code == 200 and result.json()['applied']
    assert db_session.query(Place).count() == 9 and db_session.query(GuideContent).count() == 36
    assert db_session.query(AuditLog).filter_by(action='import').count() == 1
    nearby = client.get('/places/nearby?latitude=10.749375&longitude=106.651078&radius_km=3&limit=100').json()
    assert len(nearby) >= 3 and any(row['name'] == 'Chợ Bình Tây' for row in nearby)
    pid = result.json()['rows'][0]['place_id']
    for language in ['vi', 'en', 'fr', 'ja']:
        assert client.get(f'/places/{pid}/guide-content?language={language}').status_code == 200
    repeat = client.post('/admin/catalog/hcmc/import', headers=h).json()
    assert repeat['places_to_create'] == 0 and repeat['guides_to_create'] == 0
    assert db_session.query(Place).count() == 9


def test_import_reuses_named_places_and_preserves_existing_editor_content(client, db_session):
    h = headers(db_session, 'admin')
    place = Place(**load_catalog()['places'][0]['place']); place.description = 'Edited by administrator'
    db_session.add(place); db_session.flush()
    guide = GuideContent(place_id=place.id, language_code='vi', title='Edited', content='Original narration')
    db_session.add(guide); db_session.commit()
    result = client.post('/admin/catalog/hcmc/import', headers=h).json()
    assert result['places_to_create'] == 8 and result['guides_to_create'] == 35
    assert db_session.get(Place, place.id).description == 'Edited by administrator'
    assert db_session.get(GuideContent, guide.id).content == 'Original narration'


def test_conflicting_coordinate_import_leaves_no_partial_places_or_ledger(client, db_session):
    h = headers(db_session, 'admin')
    entry = load_catalog()['places'][-1]['place']
    db_session.add(Place(**{**entry, 'latitude': 20})); db_session.commit()
    assert client.post('/admin/catalog/hcmc/import', headers=h).status_code == 409
    assert db_session.query(Place).count() == 1 and db_session.query(GuideContent).count() == 0


def test_local_sign_in_script_uses_real_login_and_admin_contract(client, db_session, monkeypatch, tmp_path):
    from contextlib import nullcontext
    from scripts import import_hcmc
    from app.services.user_service import _password_hash
    db_session.add(User(email='local-admin@example.com', full_name='Local admin', role='admin',
                        password_hash=_password_hash.hash('LocalTestPassword123!')))
    db_session.commit()
    monkeypatch.setattr('builtins.input', lambda _: 'local-admin@example.com')
    monkeypatch.setattr(import_hcmc, 'getpass', lambda _: 'LocalTestPassword123!')
    monkeypatch.setattr(import_hcmc.httpx, 'Client', lambda **_: nullcontext(client))
    monkeypatch.setattr(import_hcmc, 'RESULT', tmp_path / 'result.json')
    import_hcmc.run('http://127.0.0.1:8000', True)
    import json
    result = json.loads((tmp_path / 'result.json').read_text(encoding='utf-8'))
    assert result['places_to_create'] == 9 and len(result['verified_places']) == 9
    assert all(len(row['languages']) == 4 for row in result['verified_places'])
    assert 'access_token' not in (tmp_path / 'result.json').read_text(encoding='utf-8')
