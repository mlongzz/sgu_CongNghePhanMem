"""Bounded, server-clock presence. No GPS, page paths, input contents or device fingerprints."""
from datetime import date, datetime, time, timedelta, timezone
import os
from fastapi import HTTPException
from sqlalchemy import func, or_
from app.models.presence import UserPresencePreference, UserPresenceSession as Session
from app.models.user import User

HEARTBEAT_SECONDS = 30
TIMEOUT_SECONDS = 90
MAX_SESSION_HOURS = 24


def utcnow():
    return datetime.now(timezone.utc)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def retention_days():
    return max(7, min(90, int(os.getenv('PRESENCE_RETENTION_DAYS', '30'))))


def policy():
    return {'heartbeat_seconds': HEARTBEAT_SECONDS, 'offline_after_seconds': TIMEOUT_SECONDS,
            'retention_days': retention_days(), 'max_session_hours': MAX_SESSION_HOURS,
            'interaction_idle_seconds': 60, 'timestamps': 'UTC',
            'collection': ['session times', 'coarse platform', 'foreground duration', 'estimated interaction duration'],
            'not_collected': ['GPS', 'page paths', 'keystrokes', 'input contents', 'device fingerprint'],
            'delete_endpoint': '/presence/me', 'preferences_endpoint': '/presence/preferences'}


def tracking_enabled(db, user_id):
    preference = db.get(UserPresencePreference, user_id)
    return preference is None or preference.enabled


def online_filter(now):
    return (Session.ended_at.is_(None), Session.last_seen_at > now - timedelta(seconds=TIMEOUT_SECONDS), Session.expires_at > now)


def effective_end(row, now):
    return min(utc(row.ended_at) if row.ended_at else now, utc(row.last_seen_at) + timedelta(seconds=TIMEOUT_SECONDS), utc(row.expires_at), now)


def session_value(row, now):
    online = row.ended_at is None and utc(row.last_seen_at) + timedelta(seconds=TIMEOUT_SECONDS) > now and utc(row.expires_at) > now
    end = effective_end(row, now)
    return {'id': row.id, 'device': row.device, 'started_at': utc(row.started_at), 'last_seen_at': utc(row.last_seen_at),
            'ended_at': None if online else end, 'online': online, 'end_reason': row.end_reason or (None if online else 'timeout'),
            'duration_seconds': max(0, (end - utc(row.started_at)).total_seconds()),
            'foreground_seconds': row.foreground_seconds, 'interaction_seconds': row.interaction_seconds,
            'offline_since_estimated': None if online else end}


def lock_user(db, user_id):
    db.query(User.id).filter(User.id == user_id).with_for_update().one()


def start(db, user, data):
    lock_user(db, user.id)
    now = utcnow()
    if not tracking_enabled(db, user.id):
        raise HTTPException(403, 'Activity tracking is disabled for this account')
    client_id = str(data.client_id)
    existing = db.query(Session).filter_by(user_id=user.id, client_id=client_id).with_for_update().first()
    if existing:
        if not session_value(existing, now)['online']:
            raise HTTPException(409, 'Presence session expired; start a new client session')
        return session_value(existing, now)
    if db.query(Session).filter(Session.user_id == user.id, *online_filter(now)).count() >= 20:
        raise HTTPException(429, 'Too many active device sessions')
    row = Session(user_id=user.id, client_id=client_id, device=data.device, started_at=now, last_seen_at=now,
                  expires_at=now + timedelta(hours=MAX_SESSION_HOURS), foreground_seconds=0, interaction_seconds=0)
    db.add(row)
    from sqlalchemy.exc import IntegrityError
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = db.query(Session).filter_by(user_id=user.id, client_id=client_id).first()
        if row is None:
            raise HTTPException(409, 'Presence changed concurrently; retry') from None
        if not session_value(row, now)['online']:
            raise HTTPException(409, 'Presence session expired')
    return session_value(row, now)


def owned(db, user_id, session_id):
    row = db.query(Session).filter_by(id=str(session_id), user_id=user_id).with_for_update().first()
    if row is None:
        raise HTTPException(404, 'Presence session not found')
    return row


def heartbeat(db, user, data, ending=False):
    lock_user(db, user.id)
    now = utcnow()
    row = owned(db, user.id, data.session_id)
    value = session_value(row, now)
    if not value['online']:
        if ending:
            return value
        raise HTTPException(409, 'Presence session expired; start a new client session')
    if not tracking_enabled(db, user.id):
        raise HTTPException(403, 'Activity tracking is disabled for this account')
    elapsed = max(0, (now - utc(row.last_seen_at)).total_seconds())
    # Duplicate/rapid heartbeats cannot inflate counters or hammer writes.
    if elapsed >= 5 or ending:
        foreground = min(elapsed, data.foreground_seconds, 45)
        row.foreground_seconds += foreground
        row.interaction_seconds += min(foreground, data.interaction_seconds)
        row.last_seen_at = now
    if ending:
        row.ended_at, row.end_reason = now, data.reason
    db.commit()
    return session_value(row, now)


def delete_own(db, user):
    lock_user(db, user.id)
    preference = db.get(UserPresencePreference, user.id)
    if preference is None:
        preference = UserPresencePreference(user_id=user.id, enabled=False)
        db.add(preference)
    preference.enabled = False
    count = db.query(Session).filter_by(user_id=user.id).delete(synchronize_session=False)
    db.commit()
    return {'deleted_sessions': count, 'enabled': False}


def set_preference(db, user, enabled):
    lock_user(db, user.id)
    row = db.get(UserPresencePreference, user.id)
    if row is None:
        row = UserPresencePreference(user_id=user.id, enabled=enabled)
        db.add(row)
    row.enabled = enabled
    if not enabled:
        now = utcnow()
        for session in db.query(Session).filter(Session.user_id == user.id, *online_filter(now)).all():
            session.ended_at, session.end_reason = now, 'disabled'
    db.commit()
    return {'enabled': enabled, **policy()}


def prune(db, now=None):
    now = now or utcnow()
    identifiers = [row[0] for row in db.query(Session.id).filter(Session.last_seen_at < now - timedelta(days=retention_days())).limit(1000)]
    if identifiers:
        db.query(Session).filter(Session.id.in_(identifiers)).delete(synchronize_session=False)
        db.commit()
    return len(identifiers)


def user_values(db, users, now):
    ids = [user.id for user in users]
    if not ids:
        return []
    seen = dict(db.query(Session.user_id, func.max(Session.last_seen_at)).filter(Session.user_id.in_(ids)).group_by(Session.user_id).all())
    active = db.query(Session).filter(Session.user_id.in_(ids), *online_filter(now)).all()
    by_user = {}
    for row in active:
        by_user.setdefault(row.user_id, []).append(row)
    results = []
    for user in users:
        sessions = by_user.get(user.id, [])
        last = utc(seen[user.id]) if user.id in seen else None
        last_row = None if sessions or last is None else db.query(Session).filter_by(user_id=user.id).order_by(Session.last_seen_at.desc()).first()
        offline = effective_end(last_row, now) if last_row is not None else None
        results.append({'id': user.id, 'full_name': user.full_name, 'email': user.email, 'online': bool(sessions),
                        'active_sessions': len(sessions), 'last_seen_at': last,
                        'online_seconds': (now - min(utc(row.started_at) for row in sessions)).total_seconds() if sessions else 0,
                        'offline_seconds_estimated': max(0, (now - offline).total_seconds()) if offline else None})
    return results


def summary(db, period='day', day=None):
    now = utcnow()
    selected = day or now.date()
    if selected > now.date():
        raise HTTPException(422, 'Date cannot be in the future')
    days = {'day': 1, 'week': 7, 'month': 30}[period]
    lower = datetime.combine(selected - timedelta(days=days-1), time.min, timezone.utc)
    upper = min(datetime.combine(selected + timedelta(days=1), time.min, timezone.utc), now)
    retained = now - timedelta(days=retention_days())
    rows = db.query(Session).filter(Session.started_at <= upper, Session.last_seen_at >= max(lower-timedelta(seconds=90), retained)).all()
    started_rows = [row for row in rows if lower <= utc(row.started_at) < upper or utc(row.started_at) == upper == now]
    durations = [max(0, (effective_end(row, now) - utc(row.started_at)).total_seconds()) for row in started_rows]
    online = db.query(Session.user_id).filter(*online_filter(now)).distinct().count()
    today = datetime.combine(now.date(), time.min, timezone.utc)
    total = db.query(User).count()
    step = timedelta(minutes=30) if period == 'day' else timedelta(hours=6) if period == 'week' else timedelta(days=1)
    points, stamp = [], lower
    while stamp < upper:
        points.append({'at': stamp, 'count': None if stamp < retained else len({row.user_id for row in rows if utc(row.started_at) <= stamp < effective_end(row, now)})})
        stamp += step
    points.append({'at': upper, 'count': None if upper < retained else len({row.user_id for row in rows if utc(row.started_at) <= upper and (row.ended_at is None or utc(row.ended_at) > upper) and utc(row.last_seen_at)+timedelta(seconds=90) > upper and utc(row.expires_at) > upper})})
    return {'as_of': now, 'period': period, 'range_start': lower, 'range_end': upper, 'retention_start': retained,
            'policy': policy(), 'total_users': total, 'online_users': online, 'offline_users': total-online,
            'active_today': db.query(Session.user_id).filter(Session.last_seen_at >= today).distinct().count(),
            'sessions_today': db.query(Session).filter(Session.started_at >= today).count(), 'sessions_in_range': len(started_rows),
            'average_session_seconds': sum(durations)/len(durations) if durations else 0,
            'average_foreground_seconds': sum(row.foreground_seconds for row in started_rows)/len(started_rows) if started_rows else 0,
            'average_interaction_seconds': sum(row.interaction_seconds for row in started_rows)/len(started_rows) if started_rows else 0,
            'series': points, 'series_meaning': 'Distinct users online at each UTC sample; not peak or page views',
            'metrics_scope': 'Full durations of sessions started in the selected UTC window', 'offline_time_is_estimated': True}
