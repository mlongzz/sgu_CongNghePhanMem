from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base


class GuideContent(Base):
    __tablename__ = "guide_contents"

    id = Column(Integer, primary_key=True, index=True)
    place_id = Column(
        Integer,
        ForeignKey("places.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    language_code = Column(String(10), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    publication_status = Column(String(12), nullable=False, default="published", server_default="published")
    source_url = Column(String(1000), nullable=True)
    source_license = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("place_id", "language_code", name="uq_place_guide_language"),
        CheckConstraint("publication_status IN ('draft', 'published')", name="ck_guides_publication_status"),
    )
