from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.place_service import get_place_by_id
from app.schemas.history import HistoryResponse
from app.services.history_service import (
    clear_history_by_user,
    get_history_by_user,
    record_visit,
)


router = APIRouter(prefix="/history", tags=["History"])


@router.post("/{place_id}", response_model=HistoryResponse, status_code=status.HTTP_201_CREATED)
def record_place_visit(
    place_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not get_place_by_id(db, place_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")
    return record_visit(db, current_user.id, place_id)


@router.get("", response_model=list[HistoryResponse])
def get_my_history(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_history_by_user(db, current_user.id, limit, offset)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def clear_my_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    clear_history_by_user(db, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
