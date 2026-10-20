"""Persistent administration data; no device GPS coordinates are stored here."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class Journey(Base):
    __tablename__ = "journeys"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class JourneyStop(Base):
    __tablename__ = "journey_stops"
    id = Column(Integer, primary_key=True)
    journey_id = Column(Integer, ForeignKey("journeys.id", ondelete="CASCADE"), nullable=False, index=True)
    place_id = Column(Integer, ForeignKey("places.id", ondelete="CASCADE"), nullable=False)
    position = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("journey_id", "position", name="uq_journey_position"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(20), nullable=False)
    resource = Column(String(80), nullable=False)
    resource_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class AdminSetting(Base):
    __tablename__ = "admin_settings"
    key = Column(String(80), primary_key=True)
    value = Column(JSON, nullable=False)
