from sqlalchemy.orm import Session

from app.models.favorite import Favorite


def create_favorite(db: Session, user_id: int, place_id: int) -> Favorite:
    favorite = Favorite(
        user_id=user_id,
        place_id=place_id
    )

    db.add(favorite)
    db.commit()
    db.refresh(favorite)

    return favorite


def get_favorites_by_user(db: Session, user_id: int) -> list[Favorite]:
    return db.query(Favorite).filter(Favorite.user_id == user_id).all()


def get_favorite(db: Session, user_id: int, place_id: int) -> Favorite | None:
    return db.query(Favorite).filter(
        Favorite.user_id == user_id,
        Favorite.place_id == place_id
    ).first()


def delete_favorite(db: Session, user_id: int, place_id: int) -> Favorite | None:
    favorite = get_favorite(
        db,
        user_id,
        place_id
    )

    if favorite:
        db.delete(favorite)
        db.commit()

    return favorite
