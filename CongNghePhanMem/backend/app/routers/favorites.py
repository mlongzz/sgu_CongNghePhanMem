from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.place_service import get_place_by_id
from app.schemas.favorite import (
    FavoriteCreate,
    FavoriteResponse
)
from app.services.favorite_service import (
    create_favorite,
    get_favorites_by_user,
    get_favorite,
    delete_favorite
)


router = APIRouter(
    prefix="/favorites",
    tags=["Favorites"]
)


@router.post(
    "",
    response_model=FavoriteResponse,
    status_code=201
)
def add_favorite(
    favorite_data: FavoriteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not get_place_by_id(db, favorite_data.place_id):
        raise HTTPException(status_code=404, detail="Place not found")

    existing = get_favorite(
        db,
        current_user.id,
        favorite_data.place_id
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Place already favorited"
        )

    try:
        return create_favorite(db, current_user.id, favorite_data.place_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Place already favorited")


@router.get(
    "",
    response_model=list[FavoriteResponse]
)
def get_my_favorites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return get_favorites_by_user(
        db,
        current_user.id
    )


@router.delete(
    "/{place_id}",
    response_model=FavoriteResponse
)
def remove_favorite(
    place_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    favorite = delete_favorite(
        db,
        current_user.id,
        place_id
    )

    if not favorite:
        raise HTTPException(
            status_code=404,
            detail="Favorite not found"
        )

    return favorite
