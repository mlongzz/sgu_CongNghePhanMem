from sqlalchemy.orm import Session

from app.models.audio_session import AudioGuideSession


def create_audio_session(db: Session, user_id: int, place_id: int, language_code: str) -> AudioGuideSession:
    session = AudioGuideSession(user_id=user_id, place_id=place_id, language_code=language_code.lower())
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_audio_session(db: Session, session_id: int) -> AudioGuideSession | None:
    return db.query(AudioGuideSession).filter(AudioGuideSession.id == session_id).first()


def list_audio_sessions(db: Session, user_id: int, limit: int = 50, offset: int = 0) -> list[AudioGuideSession]:
    return (
        db.query(AudioGuideSession)
        .filter(AudioGuideSession.user_id == user_id)
        .order_by(AudioGuideSession.started_at.desc(), AudioGuideSession.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def update_audio_session(db: Session, session: AudioGuideSession, progress: float, completed: bool) -> AudioGuideSession:
    session.progress = progress
    session.completed = completed
    db.commit()
    db.refresh(session)
    return session
