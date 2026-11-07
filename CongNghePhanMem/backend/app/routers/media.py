"""Admin place images, bounded uploads, and public immutable image delivery."""
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path
import re
from uuid import uuid4
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import UPLOAD_DIR
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import AuditLog
from app.models.place import Place
from app.models.place_image import PlaceImage
from app.models.user import User
from app.schemas.place import PlaceResponse
from app.services.media_service import remove_unused_image
from app.services.image_storage import save_image
from app.services.place_service import get_place_by_id

router = APIRouter(tags=["Place images"])
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000
FILENAME = re.compile(r"^[a-f0-9]{32}(?:-thumb)?\.jpg$")


def image_file(name: str) -> Path:
    if not FILENAME.fullmatch(name):
        raise HTTPException(404, "Image not found")
    return Path(UPLOAD_DIR).resolve() / name


def normalized_image(data: bytes) -> bytes:
    from app.services.image_processing import normalize
    return normalize(data, MAX_PIXELS)


@router.get("/media/{name}")
def serve_image(name: str):
    file = image_file(name)
    if not file.is_file():
        raise HTTPException(404, "Image not found")
    return FileResponse(file, media_type="image/jpeg", headers={
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
    })


@router.post("/admin/places/{place_id}/image", response_model=PlaceResponse)
async def upload_image(place_id: int, request: Request, db: Session = Depends(get_db),
                       actor: User = Depends(get_current_admin)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Image must be at most 5 MB")
        data.extend(chunk)
    from app.services.image_manager_service import add_image
    add_image(db, place.id, normalized_image(bytes(data)), actor.id, UPLOAD_DIR, already_normalized=True)
    db.refresh(place)
    return place


@router.delete("/admin/places/{place_id}/image", response_model=PlaceResponse)
def delete_image(place_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    old = place.image_url
    place.image_url = None
    place.image_thumbnail_url = None
    place.image_source_url = None
    place.image_attribution = None
    place.image_license = None
    for candidate in db.query(PlaceImage).filter_by(place_id=place.id, url=old).all():
        candidate.status = 'rejected'
    db.add(AuditLog(actor_id=actor.id, action="delete_image", resource="places", resource_id=place.id))
    db.commit()
    db.refresh(place)
    remove_unused_image(db, old, UPLOAD_DIR)
    return place


def image_value(row):
    return {key: getattr(row, key) for key in ('id', 'place_id', 'url', 'source_url', 'attribution', 'license', 'status', 'position', 'created_at', 'reviewed_at', 'thumbnail_url', 'width', 'height', 'health_status', 'health_checked_at', 'health_error', 'story')}


@router.get('/places/{place_id}/images')
def public_images(place_id: int, db: Session = Depends(get_db)):
    if not get_place_by_id(db, place_id): raise HTTPException(404, 'Place not found')
    return [image_value(row) for row in db.query(PlaceImage).filter_by(place_id=place_id, status='approved').order_by(PlaceImage.position, PlaceImage.id).all()]


@router.get('/admin/places/{place_id}/images')
def admin_images(place_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    if not db.get(Place, place_id): raise HTTPException(404, 'Place not found')
    return [image_value(row) for row in db.query(PlaceImage).filter_by(place_id=place_id).order_by(PlaceImage.id.desc()).all()]


class ImageReview(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    status: Literal['pending', 'approved', 'rejected']
    as_cover: bool = False
    source_url: str | None = Field(None, max_length=1000)
    attribution: str | None = Field(None, max_length=500)
    license: str | None = Field(None, max_length=200)
    position: int = Field(0, ge=0, le=1000)

    @field_validator('source_url')
    @classmethod
    def valid_url(cls, value):
        if value:
            parts = urlsplit(value)
            if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password:
                raise ValueError('Source URL must be HTTP(S) without credentials')
        return value


@router.put('/admin/places/{place_id}/images/{image_id}')
def review_image(place_id: int, image_id: int, data: ImageReview, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    place = db.query(Place).filter_by(id=place_id).with_for_update().first()
    row = db.query(PlaceImage).filter_by(id=image_id, place_id=place_id).first()
    if not place or not row: raise HTTPException(404, 'Image not found')
    changes = data.model_dump(exclude_unset=True, exclude={'as_cover'})
    attribution = changes.get('attribution', row.attribution)
    license = changes.get('license', row.license)
    if data.status == 'approved' and (not attribution or not license):
        raise HTTPException(422, 'Confirm image author/attribution and license before approval')
    if data.as_cover and data.status != 'approved': raise HTTPException(422, 'Only an approved image can be a cover')
    for key, value in changes.items(): setattr(row, key, value)
    row.reviewed_at = datetime.now(timezone.utc)
    cover_fields = ('image_url', 'image_thumbnail_url', 'image_source_url', 'image_attribution', 'image_license')
    if data.as_cover or (row.url == place.image_url and row.status == 'approved'):
        place.image_url, place.image_thumbnail_url, place.image_source_url, place.image_attribution, place.image_license = row.url, row.thumbnail_url, row.source_url, row.attribution, row.license
    elif row.url == place.image_url and row.status != 'approved':
        for field in cover_fields:
            setattr(place, field, None)
    db.add(AuditLog(actor_id=actor.id, action='review_image', resource='places', resource_id=place_id))
    db.commit(); db.refresh(row)
    return {'image': image_value(row), **{field: getattr(place, field) for field in cover_fields}, 'publication_status': place.publication_status}


@router.post('/admin/places/{place_id}/images/discover')
def discover_images(place_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    from app.services.source_metadata import resolve_metadata
    from app.services.place_service import _haversine_km
    place = db.get(Place, place_id)
    if not place: raise HTTPException(404, 'Place not found')
    if not place.source_url: raise HTTPException(422, 'Add a verified Wikipedia/OSM/Wikidata source URL first')
    metadata, image = resolve_metadata(place.source_url)
    if _haversine_km(place.latitude, place.longitude, metadata['latitude'], metadata['longitude']) > 0.2:
        raise HTTPException(422, 'Source coordinates do not match this place; no image was assigned')
    if place.source != 'manual' and (place.source != metadata['source'] or place.source_id != metadata['source_id']):
        raise HTTPException(422, 'Source identity does not match this place')
    if place.source == 'manual' and place.name.casefold().strip() != metadata['name'].casefold().strip():
        raise HTTPException(422, 'Source name does not match this manually created place')
    if not image or db.query(PlaceImage).filter_by(place_id=place_id, source_url=image['source_url']).first():
        return {'added': 0, 'notice': 'No new image with sufficient identity and licensing evidence was found'}
    # Legacy discovery uses the same normalized durable storage as uploads/URL imports.
    from app.services.safe_image_download import download_image
    from app.services.image_manager_service import add_image
    _, created = add_image(db, place_id, download_image(image['url']), actor.id, UPLOAD_DIR,
                           {key:image[key] for key in ('source_url','attribution','license')})
    return {'added': int(created), 'notice': 'Image copied to configured storage for review; cover unchanged'}
