import http.client

import pytest
from fastapi import HTTPException
from app.services import translation_service


def test_missing_translation_provider_is_explicit(monkeypatch):
    monkeypatch.setattr(translation_service, 'TRANSLATION_API_URL', None)
    with pytest.raises(HTTPException) as error:
        translation_service.translate_texts(['Title', 'Content'], 'vi', 'en')
    assert error.value.status_code == 503


def test_malformed_translation_provider_response(monkeypatch):
    monkeypatch.setattr(translation_service, 'TRANSLATION_API_URL', 'https://provider.example.test')
    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self, size=-1):
            return b'{"translatedText": [42]}'
    monkeypatch.setattr(translation_service, 'urlopen', lambda *args, **kwargs: Response())
    with pytest.raises(HTTPException) as error:
        translation_service.translate_texts(['Text'], 'vi', 'en')
    assert error.value.status_code == 502


@pytest.mark.parametrize('failure', [ConnectionResetError('reset'), http.client.IncompleteRead(b'partial'), http.client.RemoteDisconnected('closed')])
def test_connection_failures_become_bad_gateway(monkeypatch, failure):
    monkeypatch.setattr(translation_service, 'TRANSLATION_API_URL', 'https://provider.example.test')
    def broken(*args, **kwargs):
        raise failure
    monkeypatch.setattr(translation_service, 'urlopen', broken)
    with pytest.raises(HTTPException) as error:
        translation_service.translate_texts(['Text'], 'vi', 'en')
    assert error.value.status_code == 502


def test_translation_response_read_is_bounded(monkeypatch):
    monkeypatch.setattr(translation_service, 'TRANSLATION_API_URL', 'https://provider.example.test')
    sizes = []
    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def read(self, size=-1):
            sizes.append(size)
            return b'{"translatedText": ["ok"]}'
    monkeypatch.setattr(translation_service, 'urlopen', lambda *args, **kwargs: Response())
    assert translation_service.translate_texts(['Text'], 'vi', 'en') == ['ok']
    assert sizes == [1_000_000]


def test_invalid_source_language_is_rejected(db_session):
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.main import app
    from app.models.user import User
    from app.routers.auth import create_access_token
    admin = User(email='admin@example.test', password_hash='unused', full_name='Admin', role='admin')
    db_session.add(admin)
    db_session.commit()
    def override():
        yield db_session
    app.dependency_overrides[get_db] = override
    try:
        response = TestClient(app).post('/places/1/guide-content/vi$$/translate', headers={'Authorization': 'Bearer ' + create_access_token(admin.id)}, json={'target_language': 'en'})
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 422
