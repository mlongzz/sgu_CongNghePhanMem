from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import AuditLog
from app.models.place import Place
from app.models.user import User
from app.schemas.guide_content import (
    GuideContentCreate,
    GuideContentResponse,
    GuideContentUpdate,
)
from app.schemas.translation import GuideTranslationRequest
from app.services.guide_content_service import (
    create_guide_content,
    get_guide_content,
    list_guide_languages,
    update_guide_content,
)
from app.services.translation_service import translate_texts


router = APIRouter(prefix="/places", tags=["Guide Content"])


@router.get("/{place_id}/guide-content/languages", response_model=list[str])
def get_available_guide_languages(place_id: int, db: Session = Depends(get_db)):
    if not db.query(Place.id).filter(Place.id == place_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return list_guide_languages(db, place_id)


@router.get("/{place_id}/guide-content", response_model=GuideContentResponse)
def get_place_guide_content(
    place_id: int,
    language: str = Query(min_length=2, max_length=10),
    db: Session = Depends(get_db),
):
    if not db.query(Place.id).filter(Place.id == place_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    guide = get_guide_content(db, place_id, language.lower())
    if not guide:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guide content not found for this language")
    return guide


@router.post(
    "/{place_id}/guide-content",
    response_model=GuideContentResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_place_guide_content(
    place_id: int,
    guide_data: GuideContentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    if not db.query(Place.id).filter(Place.id == place_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    if get_guide_content(db, place_id, guide_data.language_code.lower()):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Guide content already exists for this language")
    try:
        db.add(AuditLog(actor_id=current_user.id, action="create", resource="guides", resource_id=place_id))
        return create_guide_content(
            db, place_id, guide_data.language_code, guide_data.title, guide_data.content
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Guide content already exists for this language")


@router.put("/{place_id}/guide-content/{language_code}", response_model=GuideContentResponse)
def edit_place_guide_content(
    place_id: int,
    language_code: str,
    changes: GuideContentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    guide = get_guide_content(db, place_id, language_code.lower())
    if not guide:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guide content not found")
    update_data = changes.model_dump(exclude_unset=True)
    if update_data.get("language_code") and update_data["language_code"].lower() != language_code.lower():
        conflict = get_guide_content(db, place_id, update_data["language_code"].lower())
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Guide content already exists for this language")
    try:
        db.add(AuditLog(actor_id=current_user.id, action="update", resource="guides", resource_id=place_id))
        return update_guide_content(db, guide, update_data)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Guide content already exists for this language")


@router.post(
    "/{place_id}/guide-content/{source_language}/translate",
    response_model=GuideContentResponse,
)
def translate_place_guide_content(
    place_id: int,
    source_language: str,
    translation_request: GuideTranslationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    target_language = translation_request.target_language.lower()
    source_language = source_language.lower()
    if source_language == target_language:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source and target languages must differ")

    source = get_guide_content(db, place_id, source_language)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source guide content not found")

    target = get_guide_content(db, place_id, target_language)
    if target and not translation_request.overwrite:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Target language already exists; set overwrite to true to replace it")

    translated_title, translated_content = translate_texts(
        [source.title, source.content], source_language, target_language
    )
    db.add(AuditLog(actor_id=current_user.id, action="translate", resource="guides", resource_id=place_id))
    if target:
        return update_guide_content(
            db,
            target,
            {"title": translated_title, "content": translated_content},
        )

    try:
        return create_guide_content(
            db,
            place_id,
            target_language,
            translated_title,
            translated_content,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Target language was created concurrently")
