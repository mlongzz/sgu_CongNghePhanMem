from uuid import uuid4
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from app.database import Base


class UserPresenceSession(Base):
    __tablename__ = 'user_presence_sessions'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    client_id = Column(String(36), nullable=False)
    device = Column(String(10), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True))
    end_reason = Column(String(12))
    foreground_seconds = Column(Float, nullable=False, default=0, server_default='0')
    interaction_seconds = Column(Float, nullable=False, default=0, server_default='0')
    __table_args__ = (
        UniqueConstraint('user_id', 'client_id', name='uq_presence_client'),
        CheckConstraint('foreground_seconds >= 0 AND interaction_seconds >= 0 AND interaction_seconds <= foreground_seconds', name='ck_presence_durations'),
        Index('ix_presence_user_seen', 'user_id', 'last_seen_at'),
        Index('ix_presence_online', 'ended_at', 'last_seen_at', 'expires_at'),
        Index('ix_presence_retention', 'last_seen_at'),
    )


class UserPresencePreference(Base):
    __tablename__ = 'user_presence_preferences'
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
