from sqlalchemy.orm import Session

from app.models.guide_content import GuideContent


def get_guide_content(db: Session, place_id: int, language_code: str, *, published_only: bool = False) -> GuideContent | None:
    query = db.query(GuideContent)
    if published_only:
        query = query.filter(GuideContent.publication_status == "published")
    return (
        query
        .filter(
            GuideContent.place_id == place_id,
            GuideContent.language_code == language_code,
        )
        .first()
    )


def list_guide_languages(db: Session, place_id: int) -> list[str]:
    rows = (
        db.query(GuideContent.language_code)
        .filter(GuideContent.place_id == place_id)
        .filter(GuideContent.publication_status == "published")
        .order_by(GuideContent.language_code)
        .all()
    )
    return [row[0] for row in rows]


def create_guide_content(
    db: Session, place_id: int, language_code: str, title: str, content: str, **metadata
) -> GuideContent:
    guide = GuideContent(
        place_id=place_id,
        language_code=language_code.lower(),
        title=title,
        content=content,
        **metadata,
    )
    db.add(guide)
    db.commit()
    db.refresh(guide)
    return guide


def update_guide_content(db: Session, guide: GuideContent, changes: dict[str, object]) -> GuideContent:
    if any(key in changes for key in ("title", "content", "language_code")) and "publication_status" not in changes:
        guide.publication_status = "draft"
    for field, value in changes.items():
        if value is not None:
            setattr(guide, field, value.lower() if field == "language_code" else value)
    db.commit()
    db.refresh(guide)
    return guide
