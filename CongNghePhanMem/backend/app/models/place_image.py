from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from app.database import Base


class PlaceImage(Base):
    __tablename__ = "place_images"
    id = Column(Integer, primary_key=True)
    place_id = Column(
        Integer, ForeignKey("places.id", ondelete="CASCADE"), nullable=False
    )
    url = Column(String(1000), nullable=False)
    thumbnail_url = Column(String(1000))
    sha256 = Column(String(64))
    width = Column(Integer)
    height = Column(Integer)
    storage_backend = Column(String(12))
    health_status = Column(String(12), nullable=False, default='unknown', server_default='unknown')
    health_checked_at = Column(DateTime(timezone=True))
    health_error = Column(String(200))
    source_url = Column(String(1000), nullable=True)
    attribution = Column(String(500), nullable=True)
    license = Column(String(200), nullable=True)
    # {"vi": ..., "en": ..., "fr": ..., "ja": ...}: what this particular photo shows and its story.
    story = Column(JSON, nullable=True)
    status = Column(
        String(12), nullable=False, default="pending", server_default="pending"
    )
    position = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    __table_args__ = (
        UniqueConstraint("place_id", "url", name="uq_place_image_url"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_place_image_status",
        ),
        Index("ix_place_images_public", "place_id", "status"),
        Index("uq_place_image_sha256", "place_id", "sha256", unique=True),
    )
