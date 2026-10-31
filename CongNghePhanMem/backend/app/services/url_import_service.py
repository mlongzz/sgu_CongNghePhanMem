"""Signed, expiring previews. Import edits are bounded and never overwrite POI."""

import base64
import hashlib
import hmac
import json
import time
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from app.config import SECRET_KEY
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.models.admin import AuditLog
from app.schemas.place import PlaceCreate, PlaceResponse
from app.services.place_service import _haversine_km
from app.services.source_metadata import resolve_metadata


def duplicate(db, metadata):
    exact = (
        db.query(Place)
        .filter_by(source=metadata["source"], source_id=metadata["source_id"])
        .first()
    )
    if exact:
        return exact
    rows = (
        db.query(Place).filter(func.lower(Place.name) == metadata["name"].lower()).all()
    )
    return next(
        (
            row
            for row in rows
            if _haversine_km(
                row.latitude, row.longitude, metadata["latitude"], metadata["longitude"]
            )
            <= 0.2
        ),
        None,
    )


def sign_preview(metadata, image):
    body = base64.urlsafe_b64encode(
        json.dumps(
            {"metadata": metadata, "image": image, "expires": int(time.time()) + 600},
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        ).encode()
    ).decode()
    return (
        body
        + "."
        + hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()
    )


def read_preview(token):
    try:
        body, signature = token.rsplit(".", 1)
        if len(body) > 60000 or not hmac.compare_digest(
            signature,
            hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest(),
        ):
            raise ValueError()
        row = json.loads(base64.b64decode(body, altchars=b"-_", validate=True))
        if (
            not isinstance(row.get("expires"), int)
            or not time.time() < row["expires"] <= time.time() + 605
        ):
            raise ValueError()
        return row
    except (ValueError, TypeError, KeyError):
        raise HTTPException(
            409, "Preview invalid or expired; preview the source again"
        ) from None


def preview_url(db, url):
    metadata, image = resolve_metadata(url)
    existing = duplicate(db, metadata)
    return {
        "metadata": metadata,
        "image": image,
        "existing_place": (
            {
                "id": existing.id,
                "name": existing.name,
                "deleted": existing.deleted_at is not None,
            }
            if existing
            else None
        ),
        "preview_token": sign_preview(metadata, image),
        "expires_in_seconds": 600,
        "notice": "Draft only; primary article coordinate is not a verified entrance; images require separate approval",
    }


def import_url(db, actor, token, changes):
    reviewed = read_preview(token)
    try:
        metadata = PlaceCreate.model_validate(
            {**reviewed["metadata"], **changes, "publication_status": "draft"}
        ).model_dump()
    except ValueError:
        raise HTTPException(422, "Edited place metadata is invalid") from None
    existing = duplicate(db, metadata)
    if existing:
        if (
            existing.source == metadata["source"]
            and existing.source_id == metadata["source_id"]
            and existing.deleted_at is None
        ):
            return {
                "created": False,
                "place": PlaceResponse.model_validate(existing).model_dump(mode="json"),
            }
        raise HTTPException(
            409,
            "Matching place exists; review it instead of overwriting or restoring automatically",
        )
    try:
        row = Place(**metadata)
        db.add(row)
        db.flush()
        image = reviewed.get("image")
        if image:
            db.add(PlaceImage(place_id=row.id, **image, status="pending"))
        db.add(
            AuditLog(
                actor_id=actor.id,
                action="import_url",
                resource="places",
                resource_id=row.id,
            )
        )
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "Source was imported concurrently; refresh the preview"
        ) from None
    return {
        "created": True,
        "place": PlaceResponse.model_validate(row).model_dump(mode="json"),
    }
