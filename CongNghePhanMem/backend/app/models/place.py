from sqlalchemy import CheckConstraint, Column, Index, Integer, String, Text, Float, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Place(Base):
    __tablename__ = "places"
    __table_args__ = (
        CheckConstraint("publication_status IN ('draft', 'published')", name="ck_places_publication_status"),
        Index("uq_places_source_identity", "source", "source_id", unique=True),
        Index("ix_places_coordinates", "latitude", "longitude"),
        Index("ix_places_publication", "publication_status", "deleted_at"),
    )

    # Legacy rows remain visible after migration. API schemas explicitly default
    # new editorial content to draft, so imports never publish automatically.
    publication_status = Column(String(12), nullable=False, default="published", server_default="published")
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    source = Column(String(50), nullable=False, default="manual", server_default="manual")
    source_id = Column(String(200), nullable=True)
    source_url = Column(String(1000), nullable=True)
    source_license = Column(String(200), nullable=True)
    image_source_url = Column(String(1000), nullable=True)
    image_attribution = Column(String(500), nullable=True)
    image_license = Column(String(200), nullable=True)

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    name = Column(
        String(200),
        nullable=False,
        index=True
    )

    description = Column(
        Text,
        nullable=True
    )

    latitude = Column(
        Float,
        nullable=False
    )

    longitude = Column(
        Float,
        nullable=False
    )

    address = Column(
        String(255),
        nullable=True
    )

    category = Column(
        String(100),
        nullable=True
    )

    image_url = Column(
        String(500),
        nullable=True
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now()
    )
