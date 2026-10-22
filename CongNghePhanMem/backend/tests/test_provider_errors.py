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
        def read(self):
            return b'{"translatedText": [42]}'
    monkeypatch.setattr(translation_service, 'urlopen', lambda *args, **kwargs: Response())
    with pytest.raises(HTTPException) as error:
        translation_service.translate_texts(['Text'], 'vi', 'en')
    assert error.value.status_code == 502
