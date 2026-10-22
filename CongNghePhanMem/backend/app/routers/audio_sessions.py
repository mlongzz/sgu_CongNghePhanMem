from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.place_service import get_place_by_id
from app.schemas.audio_session import AudioSessionCreate, AudioSessionResponse, AudioSessionUpdate
from app.services.audio_session_service import (
    create_audio_session,
    get_audio_session,
    list_audio_sessions,
    update_audio_session,
)

router = APIRouter(prefix="/audio-sessions", tags=["Audio Guide Sessions"])


@router.post("", response_model=AudioSessionResponse, status_code=status.HTTP_201_CREATED)
def start_audio_session(
    request: AudioSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not get_place_by_id(db, request.place_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return create_audio_session(db, current_user.id, request.place_id, request.language_code)


@router.get("", response_model=list[AudioSessionResponse])
def get_my_audio_sessions(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return list_audio_sessions(db, current_user.id, limit, offset)


@router.patch("/{session_id}", response_model=AudioSessionResponse)
def save_audio_session_progress(
    session_id: int,
    changes: AudioSessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = get_audio_session(db, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your audio session")
    return update_audio_session(db, session, changes.progress, changes.completed)
