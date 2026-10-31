"""Atomic fixed-window throttling, shared across workers on SQLite/PostgreSQL."""
import hashlib
import hmac
import os
import time
from fastapi import HTTPException
from sqlalchemy import case, delete
from app.config import SECRET_KEY
from app.models.auth_session import LoginAttempt

WINDOW_SECONDS = 300
ACCOUNT_LIMIT = max(1, int(os.getenv('AUTH_LOGIN_LIMIT', '12')))
IP_LIMIT = max(1, int(os.getenv('AUTH_IP_LOGIN_LIMIT', '120')))


def consume_login_attempt(db, email: str, host: str):
    now = int(time.time())
    expires = (now // WINDOW_SECONDS + 1) * WINDOW_SECONDS
    if db.get_bind().dialect.name == 'postgresql':
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(delete(LoginAttempt).where(LoginAttempt.expires_at <= now))
    buckets = []
    for identity, limit in [(f'account:{email}', ACCOUNT_LIMIT), (f'ip:{host}', IP_LIMIT)]:
        key = hmac.new(SECRET_KEY.encode(), identity.encode(), hashlib.sha256).hexdigest()
        buckets.append((key, limit))
    blocked = False
    for key, limit in sorted(buckets):
        statement = insert(LoginAttempt).values(key=key, attempts=1, expires_at=expires)
        expired = LoginAttempt.expires_at <= now
        statement = statement.on_conflict_do_update(index_elements=['key'], set_={
            'attempts': case((expired, 1), else_=LoginAttempt.attempts + 1),
            'expires_at': case((expired, expires), else_=LoginAttempt.expires_at),
        }).returning(LoginAttempt.attempts)
        blocked = db.execute(statement).scalar_one() > limit or blocked
    db.commit()  # Count rejected attempts as well; never undo the throttle on a 401.
    if blocked:
        raise HTTPException(429, 'Too many login attempts. Try again later.',
                            headers={'Retry-After': str(max(1, expires - now))})
