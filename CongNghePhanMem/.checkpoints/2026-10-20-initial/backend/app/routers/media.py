"""Admin place images, bounded uploads, and public immutable image delivery."""
from io import BytesIO
from pathlib import Path
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import AuditLog
from app.models.place import Place
from app.models.user import User
from app.schemas.place import PlaceResponse
from app.services.media_service import remove_unused_image

router = APIRouter(tags=["Place images"])
MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000
FILENAME = re.compile(r"^[a-f0-9]{32}\.jpg$")


def image_file(name: str) -> Path:
    if not FILENAME.fullmatch(name):
        raise HTTPException(404, "Image not found")
    return Path(UPLOAD_DIR).resolve() / name


def normalized_image(data: bytes) -> bytes:
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(415, "Choose a JPEG, PNG or WebP image")
            if source.width * source.height > MAX_PIXELS:
                raise HTTPException(413, "Image exceeds 16 megapixels")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((2400, 2400))
            output = BytesIO()
            image.save(output, "JPEG", quality=88)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(415, "The file is not a valid image") from exc


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
    result = normalized_image(bytes(data))
    filename = uuid4().hex + ".jpg"
    target = image_file(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(result)
    old = place.image_url
    place.image_url = f"/media/{filename}"
    db.add(AuditLog(actor_id=actor.id, action="upload_image", resource="places", resource_id=place.id))
    try:
        db.commit()
        db.refresh(place)
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    remove_unused_image(db, old, UPLOAD_DIR)
    return place


@router.delete("/admin/places/{place_id}/image", response_model=PlaceResponse)
def delete_image(place_id: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    place = db.get(Place, place_id)
    if not place:
        raise HTTPException(404, "Place not found")
    old = place.image_url
    place.image_url = None
    db.add(AuditLog(actor_id=actor.id, action="delete_image", resource="places", resource_id=place.id))
    db.commit()
    db.refresh(place)
    remove_unused_image(db, old, UPLOAD_DIR)
    return place
