from datetime import date
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from app.database import get_db
from app.dependencies import get_current_admin, get_current_user
from app.models.user import User
from app.models.presence import UserPresenceSession
from app.schemas.presence import PresenceEnd, PresenceHeartbeat, PresencePreference, PresenceStart
from app.services import presence_service as service

router = APIRouter(tags=['Presence'])


@router.get('/presence/policy')
def policy():
    return service.policy()


@router.get('/presence/preferences')
def preference(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {'enabled': service.tracking_enabled(db, user.id), **service.policy()}


@router.put('/presence/preferences')
def save_preference(data: PresencePreference, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.set_preference(db, user, data.enabled)


@router.delete('/presence/me')
def delete_own(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.delete_own(db, user)


@router.post('/presence/start')
def start(data: PresenceStart, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.start(db, user, data)


@router.post('/presence/heartbeat')
def heartbeat(data: PresenceHeartbeat, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.heartbeat(db, user, data)


@router.post('/presence/end')
def end(data: PresenceEnd, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.heartbeat(db, user, data, ending=True)


@router.get('/admin/presence/summary', dependencies=[Depends(get_current_admin)])
def summary(period: Literal['day', 'week', 'month'] = 'day', day: date | None = None, db: Session = Depends(get_db)):
    return service.summary(db, period, day)


@router.get('/admin/presence', dependencies=[Depends(get_current_admin)])
def users(q: str = Query('', max_length=100), status: Literal['all', 'online', 'offline'] = 'all',
          page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), db: Session = Depends(get_db)):
    now = service.utcnow()
    query = db.query(User)
    if q:
        term = f'%{q.strip()}%'
        query = query.filter(or_(User.email.ilike(term), User.full_name.ilike(term)))
    active = db.query(UserPresenceSession.user_id).filter(*service.online_filter(now))
    if status != 'all':
        query = query.filter(User.id.in_(active) if status == 'online' else ~User.id.in_(active))
    latest = db.query(UserPresenceSession.user_id, func.max(UserPresenceSession.last_seen_at).label('seen')).group_by(UserPresenceSession.user_id).subquery()
    query = query.outerjoin(latest, User.id == latest.c.user_id).order_by(latest.c.seen.desc().nullslast(), User.id)
    count = query.count()
    rows = query.offset((page-1)*page_size).limit(page_size).all()
    return {'items': service.user_values(db, rows, now), 'total': count, 'page': page, 'pages': (count+page_size-1)//page_size, 'as_of': now}


@router.get('/admin/presence/users/{user_id}', dependencies=[Depends(get_current_admin)])
def detail(user_id: int, page: int = Query(1, ge=1), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, 'User not found')
    query = db.query(UserPresenceSession).filter_by(user_id=user_id).order_by(UserPresenceSession.started_at.desc())
    now = service.utcnow()
    return {'user': service.user_values(db, [user], now)[0], 'sessions': [service.session_value(row, now) for row in query.offset((page-1)*25).limit(25)],
            'total': query.count(), 'page': page, 'policy': service.policy()}
