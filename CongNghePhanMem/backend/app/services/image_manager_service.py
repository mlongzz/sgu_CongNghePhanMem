import hashlib
from pathlib import Path
from uuid import uuid4
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.models.place_image import PlaceImage
from app.models.admin import AuditLog
from app.services.image_processing import normalize,thumbnail
from app.services.image_storage import save_image,storage_configuration


def add_image(db,place_id,data,actor_id,directory,metadata=None,already_normalized=False):
    normalized=data if already_normalized else normalize(data)
    digest=hashlib.sha256(normalized).hexdigest()
    existing=db.query(PlaceImage).filter_by(place_id=place_id,sha256=digest).first()
    if existing:
        return existing,False
    small,width,height=thumbnail(normalized)
    identity=uuid4().hex;urls=[]
    try:
        url=save_image(normalized,identity,directory);urls.append(url)
        preview=save_image(small,identity+'-thumb',directory);urls.append(preview)
        row=PlaceImage(place_id=place_id,url=url,thumbnail_url=preview,sha256=digest,width=width,height=height,
                       storage_backend=storage_configuration(),status='pending',health_status='ok',**(metadata or {}))
        db.add(row);db.add(AuditLog(actor_id=actor_id,action='upload_image',resource='places',resource_id=place_id))
        db.commit();db.refresh(row)
        return row,True
    except Exception as error:
        db.rollback()
        from app.services.media_service import remove_unused_image
        for url in urls:
            remove_unused_image(db,url,directory)
        if isinstance(error,IntegrityError):
            duplicate=db.query(PlaceImage).filter_by(place_id=place_id,sha256=digest).first()
            if duplicate:
                return duplicate,False
            raise HTTPException(409,'Image changed concurrently; refresh the gallery') from None
        raise
