"""Router for Review endpoints under /places/{place_id}/reviews."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.place import Place
from app.models.user import User
from app.schemas.review import (
    PlaceRatingSummary,
    ReviewCreate,
    ReviewResponse,
    ReviewUpdate,
)
from app.services.review_service import (
    count_reviews_for_place,
    create_review,
    delete_review,
    get_place_rating_summary,
    get_review,
    get_review_by_id,
    list_reviews_for_place,
    update_review,
)

router = APIRouter(prefix="/places", tags=["Reviews"])


def _require_place(place_id: int, db: Session) -> None:
    """Raise 404 if the place doesn't exist."""
    if not db.query(Place.id).filter(Place.id == place_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Place not found")


# ─── Rating summary ───────────────────────────────────────────────────────────

@router.get("/{place_id}/reviews/summary", response_model=PlaceRatingSummary)
def get_rating_summary(place_id: int, db: Session = Depends(get_db)):
    """Return average rating and review count for a place."""
    _require_place(place_id, db)
    return get_place_rating_summary(db, place_id)


# ─── List reviews ─────────────────────────────────────────────────────────────

@router.get("/{place_id}/reviews", response_model=list[ReviewResponse])
def list_place_reviews(
    place_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Return paginated reviews for a place."""
    _require_place(place_id, db)
    return list_reviews_for_place(db, place_id, limit, offset)


# ─── Create review ────────────────────────────────────────────────────────────

@router.post(
    "/{place_id}/reviews",
    response_model=ReviewResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_review(
    place_id: int,
    review_data: ReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a review for a place. Each user can only review a place once."""
    _require_place(place_id, db)
    existing = get_review(db, current_user.id, place_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reviewed this place",
        )
    try:
        return create_review(db, current_user.id, place_id, review_data.rating, review_data.comment)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already reviewed this place",
        )


# ─── Update review ────────────────────────────────────────────────────────────

@router.put("/{place_id}/reviews/{review_id}", response_model=ReviewResponse)
def edit_review(
    place_id: int,
    review_id: int,
    changes: ReviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update your own review."""
    _require_place(place_id, db)
    review = get_review_by_id(db, review_id)
    if not review or review.place_id != place_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your review")
    return update_review(db, review, changes.model_dump(exclude_unset=True))


# ─── Delete review ────────────────────────────────────────────────────────────

@router.delete("/{place_id}/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_review(
    place_id: int,
    review_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete your own review."""
    _require_place(place_id, db)
    review = get_review_by_id(db, review_id)
    if not review or review.place_id != place_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    if review.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your review")
    delete_review(db, review)
