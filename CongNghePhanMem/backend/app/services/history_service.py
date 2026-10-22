from sqlalchemy.orm import Session

from app.models.history import History


def record_visit(db: Session, user_id: int, place_id: int) -> History:
    visit = History(user_id=user_id, place_id=place_id)
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return visit


def get_history_by_user(
    db: Session, user_id: int, limit: int = 50, offset: int = 0
) -> list[History]:
    return (
        db.query(History)
        .filter(History.user_id == user_id)
        .order_by(History.visited_at.desc(), History.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def clear_history_by_user(db: Session, user_id: int) -> None:
    db.query(History).filter(History.user_id == user_id).delete(synchronize_session=False)
    db.commit()
