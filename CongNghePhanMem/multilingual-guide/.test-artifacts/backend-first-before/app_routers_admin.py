from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import ADMIN_USER_IDS, TRANSLATION_API_URL
from app.database import get_db
from app.dependencies import get_current_admin
from app.models.admin import AdminSetting, AuditLog, Journey, JourneyStop
from app.models.audio_session import AudioGuideSession
from app.models.guide_content import GuideContent
from app.models.history import History
from app.models.place import Place
from app.models.user import User
from app.schemas.admin import AdminUserCreate, JourneyWrite, RoleUpdate, SettingsWrite
from app.schemas.guide_content import GuideContentCreate
from app.schemas.place import PlaceCreate, PlaceUpdate
from app.services.media_service import remove_unused_image
from app.schemas.user import UserResponse, UserUpdate
from app.services.user_service import _password_hash

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(get_current_admin)])


def serialize(row):
    return jsonable_encoder({column.name: getattr(row, column.name) for column in row.__table__.columns
                             if column.name != "password_hash"})


def required(db, model, identifier):
    row = db.get(model, identifier)
    if row is None:
        raise HTTPException(404, "Resource not found")
    return row


def commit(db, actor, action, resource, identifier=None):
    """Record successful writes in the same transaction as their audit entry."""
    db.add(AuditLog(actor_id=actor.id, action=action, resource=resource, resource_id=identifier))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Conflicting or referenced resource") from exc


def paginate(query, page, page_size):
    total = query.count()
    return {"items": [serialize(row) for row in query.offset((page - 1) * page_size).limit(page_size).all()],
            "total": total, "page": page, "page_size": page_size,
            "pages": (total + page_size - 1) // page_size}


@router.get("/me")
def get_admin_status(current_user: User = Depends(get_current_admin)) -> dict[str, object]:
    """Expose the authenticated user's admin capability to the app UI."""
    return {"enabled": True, "user_id": current_user.id}


@router.get("/overview")
def overview(
    period: Literal["day", "month", "year"] = "day",
    start: date | None = None, end: date | None = None,
    db: Session = Depends(get_db),
):
    end = end or datetime.now(timezone.utc).date()
    start = start or end - timedelta(days=29)
    if start > end or (end - start).days > 3660:
        raise HTTPException(422, "Date range must be ordered and at most 3660 days")
    lower = datetime.combine(start, time.min, timezone.utc)
    upper = datetime.combine(end + timedelta(days=1), time.min, timezone.utc)
    sessions = db.query(AudioGuideSession).filter(AudioGuideSession.started_at >= lower,
                                                 AudioGuideSession.started_at < upper)
    # SQL aggregation keeps analytics bounded even with a large playback history.
    stamp = AudioGuideSession.started_at
    bucket = func.extract("year", stamp)
    groups = [bucket]
    if period in ("month", "day"):
        groups.append(func.extract("month", stamp))
    if period == "day":
        groups.append(func.extract("day", stamp))
    rows = sessions.with_entities(*groups, func.count(AudioGuideSession.id)).group_by(*groups).order_by(*groups).all()
    series = [{"label": "-".join(str(int(v)).zfill(4 if i == 0 else 2) for i, v in enumerate(row[:-1])),
               "count": row[-1]} for row in rows]
    languages = sessions.with_entities(AudioGuideSession.language_code, func.count(AudioGuideSession.id)).group_by(
        AudioGuideSession.language_code).order_by(func.count(AudioGuideSession.id).desc()).all()
    popular = sessions.join(Place, Place.id == AudioGuideSession.place_id).with_entities(
        Place.id, Place.name, func.count(AudioGuideSession.id)).group_by(Place.id, Place.name).order_by(
        func.count(AudioGuideSession.id).desc(), Place.id).limit(10).all()
    return {"start": start, "end": end, "timezone": "UTC", "period": period,
            "kpis": {"users": db.query(User).count(), "places": db.query(Place).count(),
                     "guides": db.query(GuideContent).count(), "journeys": db.query(Journey).count(),
                     "plays": sessions.count(), "completed": sessions.filter(AudioGuideSession.completed.is_(True)).count(),
                     "visits": db.query(History).filter(History.visited_at >= lower, History.visited_at < upper).count()},
            "series": series, "languages": [{"language": key, "count": count} for key, count in languages],
            "popular": [{"id": key, "name": name, "count": count} for key, name, count in popular]}


@router.get("/status")
def service_status(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        database = "reachable"
    except SQLAlchemyError:
        db.rollback()
        database = "unreachable"
    return {"api": "reachable", "database": database,
            "translation": "configured (not probed)" if TRANSLATION_API_URL else "not configured",
            "tts": "device speech; availability checked on client"}


@router.get("/users")
def list_users(q: str = Query("", max_length=200), role: Literal["admin", "user"] | None = None,
               page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(User).filter(or_(User.email.ilike(f"%{q}%"), User.full_name.ilike(f"%{q}%")))
    if role:
        query = query.filter(User.role == role)
    return paginate(query.order_by(User.id.desc()), page, page_size)


@router.post("/users", response_model=UserResponse, status_code=201)
def add_user(data: AdminUserCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = User(**data.model_dump(exclude={"password"}), password_hash=_password_hash.hash(data.password))
    db.add(row)
    commit(db, actor, "create", "users")
    return row


@router.put("/users/{identifier}", response_model=UserResponse)
def edit_user(identifier: int, data: UserUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = required(db, User, identifier)
    for key, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, key, value)
    commit(db, actor, "update", "users", identifier)
    return row


@router.patch("/users/{identifier}/role", response_model=UserResponse)
def edit_role(identifier: int, data: RoleUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = required(db, User, identifier)
    if identifier == actor.id or identifier in ADMIN_USER_IDS:
        raise HTTPException(409, "Cannot change own role or environment bootstrap administrator")
    row.role = data.role
    commit(db, actor, "role", "users", identifier)
    return row


@router.delete("/users/{identifier}", status_code=204)
def remove_user(identifier: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    if identifier == actor.id or identifier in ADMIN_USER_IDS:
        raise HTTPException(409, "Cannot delete own account or bootstrap administrator")
    db.delete(required(db, User, identifier))
    commit(db, actor, "delete", "users", identifier)
    return Response(status_code=204)


@router.get("/places")
def list_places(q: str = Query("", max_length=200), category: str | None = Query(None, max_length=100),
                page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(Place).filter(Place.name.ilike(f"%{q}%"))
    if category:
        query = query.filter(Place.category == category)
    return paginate(query.order_by(Place.id.desc()), page, page_size)


@router.post("/places", status_code=201)
def add_place(data: PlaceCreate, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = Place(**data.model_dump())
    db.add(row)
    commit(db, actor, "create", "places")
    return serialize(row)


@router.put("/places/{identifier}")
def edit_place(identifier: int, data: PlaceUpdate, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = required(db, Place, identifier)
    old_image = row.image_url
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    commit(db, actor, "update", "places", identifier)
    remove_unused_image(db, old_image)
    return serialize(row)


@router.delete("/places/{identifier}", status_code=204)
def remove_place(identifier: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = required(db, Place, identifier)
    old_image = row.image_url
    db.delete(row)
    commit(db, actor, "delete", "places", identifier)
    remove_unused_image(db, old_image)
    return Response(status_code=204)


@router.get("/guides")
def list_guides(q: str = Query("", max_length=200), language: str | None = Query(None, max_length=10),
                place_id: int | None = None, page: int = Query(1, ge=1),
                page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(GuideContent).filter(GuideContent.title.ilike(f"%{q}%"))
    if language:
        query = query.filter(GuideContent.language_code == language.lower())
    if place_id is not None:
        query = query.filter(GuideContent.place_id == place_id)
    return paginate(query.order_by(GuideContent.id.desc()), page, page_size)


@router.put("/places/{place_id}/guide-content/{language_code}")
def upsert_guide(place_id: int, language_code: str, data: GuideContentCreate,
                 db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    required(db, Place, place_id)
    if language_code.lower() != data.language_code.lower():
        raise HTTPException(422, "Language in URL and payload must match")
    row = db.query(GuideContent).filter_by(place_id=place_id, language_code=language_code.lower()).first()
    if row is None:
        row = GuideContent(place_id=place_id)
        db.add(row)
    for key, value in data.model_dump().items():
        setattr(row, key, value.lower() if key == "language_code" else value)
    commit(db, actor, "upsert", "guides", place_id)
    return serialize(row)


@router.delete("/guides/{identifier}", status_code=204)
def remove_guide(identifier: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    db.delete(required(db, GuideContent, identifier))
    commit(db, actor, "delete", "guides", identifier)
    return Response(status_code=204)


def journey_value(db, row):
    return {**serialize(row), "place_ids": [stop.place_id for stop in db.query(JourneyStop).filter_by(
        journey_id=row.id).order_by(JourneyStop.position).all()]}


@router.get("/journeys")
def list_journeys(q: str = Query("", max_length=200), page: int = Query(1, ge=1),
                  page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    query = db.query(Journey).filter(Journey.name.ilike(f"%{q}%")).order_by(Journey.id.desc())
    result = paginate(query, page, page_size)
    result["items"] = [journey_value(db, row) for row in query.offset((page-1)*page_size).limit(page_size).all()]
    return result


def save_journey(db, actor, data, row):
    if db.query(Place).filter(Place.id.in_(data.place_ids)).count() != len(data.place_ids):
        raise HTTPException(422, "One or more stops do not exist")
    row.name, row.description = data.name, data.description
    db.add(row)
    db.flush()
    db.query(JourneyStop).filter_by(journey_id=row.id).delete(synchronize_session=False)
    for position, place_id in enumerate(data.place_ids):
        db.add(JourneyStop(journey_id=row.id, place_id=place_id, position=position))
    commit(db, actor, "save", "journeys", row.id)
    return journey_value(db, row)


@router.post("/journeys", status_code=201)
def add_journey(data: JourneyWrite, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    return save_journey(db, actor, data, Journey())


@router.put("/journeys/{identifier}")
def edit_journey(identifier: int, data: JourneyWrite, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    return save_journey(db, actor, data, required(db, Journey, identifier))


@router.delete("/journeys/{identifier}", status_code=204)
def remove_journey(identifier: int, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    db.delete(required(db, Journey, identifier))
    commit(db, actor, "delete", "journeys", identifier)
    return Response(status_code=204)


@router.get("/playback")
def playback(language: str | None = Query(None, max_length=10), place_id: int | None = None,
             completed: bool | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
             db: Session = Depends(get_db)):
    query = db.query(AudioGuideSession)
    if language:
        query = query.filter(AudioGuideSession.language_code == language)
    if place_id is not None:
        query = query.filter(AudioGuideSession.place_id == place_id)
    if completed is not None:
        query = query.filter(AudioGuideSession.completed == completed)
    return paginate(query.order_by(AudioGuideSession.id.desc()), page, page_size)


@router.get("/audit-logs")
def audit_logs(q: str = Query("", max_length=80), page: int = Query(1, ge=1),
               page_size: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    return paginate(db.query(AuditLog).filter(AuditLog.resource.ilike(f"%{q}%")).order_by(AuditLog.id.desc()), page, page_size)


@router.get("/settings")
def read_settings(db: Session = Depends(get_db)):
    row = db.get(AdminSetting, "general")
    return row.value if row else SettingsWrite().model_dump()


@router.put("/settings")
def write_settings(data: SettingsWrite, db: Session = Depends(get_db), actor: User = Depends(get_current_admin)):
    row = db.get(AdminSetting, "general") or AdminSetting(key="general")
    row.value = data.model_dump()
    db.add(row)
    commit(db, actor, "update", "settings")
    return row.value
