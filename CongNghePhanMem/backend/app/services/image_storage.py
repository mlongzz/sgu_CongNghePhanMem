"""Local development or signed Cloudinary upload. No cloud resources are created."""

import hashlib
import os
from pathlib import Path
import re
import time
import httpx2 as httpx
from fastapi import HTTPException
from app.config import UPLOAD_DIR


def storage_configuration():
    backend = os.getenv("MEDIA_STORAGE_BACKEND", "local")
    if backend not in ("local", "cloudinary", "r2"):
        raise RuntimeError("MEDIA_STORAGE_BACKEND must be local, cloudinary or r2")
    if os.getenv("APP_ENV") == "production" and backend == "local":
        raise RuntimeError("Configure durable image storage before production startup")
    if backend == "cloudinary" and not all(
        os.getenv(name)
        for name in (
            "CLOUDINARY_CLOUD_NAME",
            "CLOUDINARY_API_KEY",
            "CLOUDINARY_API_SECRET",
        )
    ):
        raise RuntimeError("Cloudinary server credentials are missing")
    if backend == "r2":
        from app.services.r2_storage import configuration
        configuration()
    return backend


def save_image(data: bytes, identity: str, local_directory: str | None = None) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", identity):
        raise ValueError("Invalid generated image identity")
    backend = storage_configuration()
    if backend == "r2":
        from app.services.r2_storage import save
        return save(data, identity)
    if backend == "local":
        folder = Path(local_directory or UPLOAD_DIR).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (identity + ".jpg")).write_bytes(data)
        return f"/media/{identity}.jpg"
    cloud = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", cloud):
        raise RuntimeError("Invalid Cloudinary cloud name")
    params = {
        "folder": "multilingual-guide",
        "public_id": identity,
        "timestamp": str(int(time.time())),
    }
    signature = hashlib.sha256(
        (
            "&".join(f"{key}={params[key]}" for key in sorted(params))
            + os.environ["CLOUDINARY_API_SECRET"]
        ).encode()
    ).hexdigest()
    try:
        with httpx.Client(
            timeout=25, follow_redirects=False, trust_env=False
        ) as client:
            response = client.post(
                f"https://api.cloudinary.com/v1_1/{cloud}/image/upload",
                data={
                    **params,
                    "api_key": os.environ["CLOUDINARY_API_KEY"],
                    "signature": signature,
                },
                files={"file": (identity + ".jpg", data, "image/jpeg")},
            )
        if response.status_code != 200 or len(response.content) > 100_000:
            raise ValueError()
        value = response.json().get("secure_url", "")
        if not isinstance(value, str) or not value.startswith(
            f"https://res.cloudinary.com/{cloud}/image/upload/"
        ):
            raise ValueError()
        return value
    except (httpx.HTTPError, ValueError, KeyError):
        raise HTTPException(
            502, "Image storage is unavailable; no cover was changed"
        ) from None
