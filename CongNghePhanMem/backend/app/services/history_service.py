from sqlalchemy.orm import Session

from app.models.history import History
from app.models.place import Place


def record_visit(db: Session, user_id: int, place_id: int) -> History:
    visit = History(user_id=user_id, place_id=place_id)
    db.add(visit)
    db.commit()
    db.refresh(visit)
    visit.place_name = db.query(Place.name).filter(Place.id == place_id, Place.deleted_at.is_(None)).scalar()
    return visit


def get_history_by_user(
    db: Session, user_id: int, limit: int = 50, offset: int = 0
) -> list[History]:
    rows = (
        db.query(History, Place.name)
        .outerjoin(Place, (Place.id == History.place_id) & Place.deleted_at.is_(None))
        .filter(History.user_id == user_id)
        .order_by(History.visited_at.desc(), History.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    for visit, place_name in rows:
        visit.place_name = place_name
    return [visit for visit, _ in rows]


def clear_history_by_user(db: Session, user_id: int) -> None:
    db.query(History).filter(History.user_id == user_id).delete(synchronize_session=False)
    db.commit()
