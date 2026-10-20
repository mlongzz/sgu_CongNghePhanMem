"""Database operations for place reviews and rating summaries."""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.review import Review
from app.schemas.review import PlaceRatingSummary


def get_review(db: Session, user_id: int, place_id: int) -> Review | None:
    """Return a user's review for a place, if one exists."""
    return (
        db.query(Review)
        .filter(Review.user_id == user_id, Review.place_id == place_id)
        .first()
    )


def get_review_by_id(db: Session, review_id: int) -> Review | None:
    return db.query(Review).filter(Review.id == review_id).first()


def list_reviews_for_place(
    db: Session, place_id: int, limit: int = 20, offset: int = 0
) -> list[Review]:
    """Return a stable, paginated list of newest reviews for a place."""
    return (
        db.query(Review)
        .filter(Review.place_id == place_id)
        .order_by(Review.created_at.desc(), Review.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def count_reviews_for_place(db: Session, place_id: int) -> int:
    return int(db.query(func.count(Review.id)).filter(Review.place_id == place_id).scalar() or 0)


def get_place_rating_summary(db: Session, place_id: int) -> PlaceRatingSummary:
    average, count = (
        db.query(func.avg(Review.rating), func.count(Review.id))
        .filter(Review.place_id == place_id)
        .one()
    )
    return PlaceRatingSummary(
        place_id=place_id,
        average_rating=round(float(average), 2) if average is not None else None,
        review_count=int(count or 0),
    )


def create_review(
    db: Session, user_id: int, place_id: int, rating: int, comment: str | None
) -> Review:
    review = Review(
        user_id=user_id,
        place_id=place_id,
        rating=rating,
        comment=comment,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


def update_review(db: Session, review: Review, changes: dict[str, object]) -> Review:
    for field, value in changes.items():
        setattr(review, field, value)
    db.commit()
    db.refresh(review)
    return review


def delete_review(db: Session, review: Review) -> None:
    db.delete(review)
    db.commit()
