import hashlib
import pytest
import httpx2
from fastapi import HTTPException
from app.services import image_storage


def test_production_refuses_ephemeral_storage(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MEDIA_STORAGE_BACKEND", "local")
    with pytest.raises(RuntimeError):
        image_storage.storage_configuration()


def test_cloudinary_upload_is_signed_server_side_and_uses_fixed_host(monkeypatch):
    monkeypatch.setenv("MEDIA_STORAGE_BACKEND", "cloudinary")
    monkeypatch.setenv("CLOUDINARY_CLOUD_NAME", "fixture-cloud")
    monkeypatch.setenv("CLOUDINARY_API_KEY", "fixture-key")
    monkeypatch.setenv("CLOUDINARY_API_SECRET", "fixture-secret")
    monkeypatch.setattr(image_storage.time, "time", lambda: 1000)
    real = image_storage.httpx.Client
    calls = []

    def handler(request):
        calls.append(request)
        assert request.url.host == "api.cloudinary.com"
        body = request.content
        assert b"fixture-secret" not in body
        expected = (
            hashlib.sha256(
                b"folder=multilingual-guide&public_id=fixture-id&timestamp=1000fixture-secret"
            )
            .hexdigest()
            .encode()
        )
        assert expected in body and b"fixture-key" in body
        assert "authorization" not in request.headers
        return httpx2.Response(
            200,
            json={
                "secure_url": "https://res.cloudinary.com/fixture-cloud/image/upload/fixture-id.jpg"
            },
        )

    monkeypatch.setattr(
        image_storage.httpx,
        "Client",
        lambda **kwargs: real(transport=httpx2.MockTransport(handler), **kwargs),
    )
    result = image_storage.save_image(b"normalized fixture bytes", "fixture-id")
    assert (
        result.startswith("https://res.cloudinary.com/fixture-cloud/")
        and len(calls) == 1
    )


def test_missing_cloud_credentials_fail_without_a_network_call(monkeypatch):
    monkeypatch.setenv("MEDIA_STORAGE_BACKEND", "cloudinary")
    monkeypatch.delenv("CLOUDINARY_API_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        image_storage.save_image(b"fixture", "id")
