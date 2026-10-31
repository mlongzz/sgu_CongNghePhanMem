"""Small persisted auth state shared by API workers; no raw refresh tokens or IPs."""
from sqlalchemy import Column, ForeignKey, Integer, String
from app.database import Base


class RefreshSession(Base):
    __tablename__ = 'auth_refresh_sessions'
    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    token_hash = Column(String(64), nullable=False)
    expires_at = Column(Integer, nullable=False, index=True)


class LoginAttempt(Base):
    __tablename__ = 'auth_login_attempts'
    key = Column(String(64), primary_key=True)
    attempts = Column(Integer, nullable=False)
    expires_at = Column(Integer, nullable=False, index=True)
