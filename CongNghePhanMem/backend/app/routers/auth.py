"""
Authentication router: login + refresh token.
JWT secrets are read from app.config (no circular imports).
"""
from datetime import datetime, timedelta, timezone
import hashlib
import time
import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, REFRESH_TOKEN_EXPIRE_DAYS, SECRET_KEY
from app.database import get_db
from app.schemas.user import LoginRequest, LoginResponse, RefreshRequest
from app.services.user_service import get_user_by_email, get_user_by_id, verify_password
from app.services.user_service import _password_hash
from app.services.login_throttle import consume_login_attempt
from app.models.auth_session import RefreshSession

_DUMMY_HASH = _password_hash.hash(uuid.uuid4().hex)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ─── Token helpers ────────────────────────────────────────────────────────────

def _create_token(user_id: int, token_type: str, expire_delta: timedelta, **claims) -> str:
    """Encode a JWT with the given expiry and a 'type' claim."""
    expire = datetime.now(timezone.utc) + expire_delta
    payload = {"sub": str(user_id), "exp": expire, "type": token_type, 'jti': uuid.uuid4().hex, **claims}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(user_id: int) -> str:
    return _create_token(user_id, "access", timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: int) -> str:
    return _create_token(user_id, "refresh", timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def _refresh_pair(user_id: int, session_id: str):
    token = _create_token(user_id, 'refresh', timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS), sid=session_id)
    return token, hashlib.sha256(token.encode()).hexdigest()


def _decode_refresh(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM],
                             options={'require': ['exp', 'sub', 'type', 'sid', 'jti']})
        if payload['type'] != 'refresh' or not isinstance(payload['sid'], str):
            raise ValueError()
        payload['user_id'] = int(payload['sub'])
        return payload
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError) as exc:
        raise HTTPException(401, 'Invalid refresh token') from exc


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
def login(login_data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate with email + password and receive access & refresh tokens."""
    consume_login_attempt(db, login_data.email, request.client.host if request.client else 'unknown')
    user = get_user_by_email(db, login_data.email)
    # Always run the same expensive password verifier, including unknown accounts.
    valid_password = verify_password(login_data.password, user.password_hash if user else _DUMMY_HASH)

    if not user or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    session_id = str(uuid.uuid4())
    token, digest = _refresh_pair(user.id, session_id)
    db.execute(delete(RefreshSession).where(RefreshSession.expires_at <= int(time.time())))
    db.add(RefreshSession(id=session_id, user_id=user.id, token_hash=digest,
                          expires_at=int(time.time()) + REFRESH_TOKEN_EXPIRE_DAYS * 86400))
    db.commit()
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": token,
        "token_type": "bearer",
    }


@router.post("/refresh", response_model=LoginResponse)
def refresh_tokens(request: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange a valid refresh token for a new access + refresh token pair."""
    payload = _decode_refresh(request.refresh_token)
    user_id = payload['user_id']
    if not get_user_by_id(db, user_id):
        raise HTTPException(401, 'Invalid refresh token')
    token, digest = _refresh_pair(user_id, payload['sid'])
    changed = db.execute(update(RefreshSession).where(
        RefreshSession.id == payload['sid'], RefreshSession.user_id == user_id,
        RefreshSession.token_hash == hashlib.sha256(request.refresh_token.encode()).hexdigest(),
        RefreshSession.expires_at > int(time.time()),
    ).values(token_hash=digest, expires_at=int(time.time()) + REFRESH_TOKEN_EXPIRE_DAYS * 86400))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(401, 'Invalid refresh token')
    db.commit()
    return {
        "access_token": create_access_token(user_id),
        "refresh_token": token,
        "token_type": "bearer",
    }


@router.post('/logout', status_code=204)
def logout(request: RefreshRequest, db: Session = Depends(get_db)):
    """Revoke this refresh family, including an in-flight rotation. Access JWTs expire normally."""
    payload = _decode_refresh(request.refresh_token)
    db.execute(delete(RefreshSession).where(RefreshSession.id == payload['sid'],
                                             RefreshSession.user_id == payload['user_id']))
    db.commit()
    return Response(status_code=204)
