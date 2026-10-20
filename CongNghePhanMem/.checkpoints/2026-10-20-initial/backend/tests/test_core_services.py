import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import sessionmaker

from app.dependencies import get_current_admin
from app.models.audio_session import AudioGuideSession
from app.models.place import Place
from app.models.user import User
from app.services.audio_session_service import (
    create_audio_session,
    list_audio_sessions,
    update_audio_session,
)
from app.schemas.place import PlaceUpdate
from app.schemas.review import ReviewUpdate
from app.schemas.user import UserUpdate
from app.services.place_service import get_nearby_places
from app.services.review_service import (
    count_reviews_for_place,
    create_review,
    get_place_rating_summary,
)
from app.schemas.audio_session import AudioSessionUpdate
from scripts import seed_demo


def test_review_summary_and_count(db_session):
    user = User(email="reviewer@example.test", password_hash="hash", full_name="Reviewer")
    place = Place(name="Museum", latitude=16.46, longitude=107.59)
    db_session.add_all([user, place])
    db_session.commit()

    empty = get_place_rating_summary(db_session, place.id)
    assert empty.average_rating is None
    assert empty.review_count == 0

    create_review(db_session, user.id, place.id, 4, "Great visit")
    create_review(db_session, user.id + 1, place.id, 5, None)
    summary = get_place_rating_summary(db_session, place.id)

    assert summary.average_rating == 4.5
    assert summary.review_count == 2
    assert count_reviews_for_place(db_session, place.id) == 2


def test_nearby_search_wraps_across_antimeridian(db_session):
    across_dateline = Place(name="Across", latitude=0, longitude=-179.95)
    far_away = Place(name="Far", latitude=0, longitude=160)
    db_session.add_all([across_dateline, far_away])
    db_session.commit()

    results = get_nearby_places(db_session, 0, 179.95, radius_km=30)

    assert [place.id for place, _distance in results] == [across_dateline.id]


@pytest.mark.parametrize(
    "build_model",
    [
        lambda: PlaceUpdate(latitude=None),
        lambda: ReviewUpdate(rating=None),
        lambda: UserUpdate(full_name=None),
    ],
)
def test_updates_reject_null_for_required_columns(build_model):
    with pytest.raises(ValidationError):
        build_model()


def test_unconfigured_user_is_not_admin():
    user = User(id=999, email="member@example.test", password_hash="hash", full_name="Member")

    with pytest.raises(HTTPException) as error:
        get_current_admin(user)

    assert error.value.status_code == 403


def test_audio_session_saves_progress_for_owner(db_session):
    user = User(email="listener@example.test", password_hash="hash", full_name="Listener")
    place = Place(name="Citadel", latitude=16.46, longitude=107.59)
    db_session.add_all([user, place])
    db_session.commit()

    session = create_audio_session(db_session, user.id, place.id, "VI")
    saved = update_audio_session(db_session, session, 0.6, False)

    assert saved.progress == 0.6
    assert saved.language_code == "vi"
    assert not saved.completed
    assert len(list_audio_sessions(db_session, user.id)) == 1
    completed = update_audio_session(db_session, saved, 1.0, True)
    assert completed.completed


def test_audio_session_progress_is_bounded():
    with pytest.raises(ValidationError):
        AudioSessionUpdate(progress=1.1)
    with pytest.raises(ValidationError):
        AudioSessionUpdate(progress=0.9, completed=True)


def test_demo_seed_is_idempotent(db_session, monkeypatch):
    monkeypatch.setattr(seed_demo, "engine", db_session.get_bind())
    monkeypatch.setattr(seed_demo, "SessionLocal", sessionmaker(bind=db_session.get_bind()))

    assert seed_demo.seed() == (3, 9)
    assert seed_demo.seed() == (0, 0)
    assert db_session.query(Place).count() == 3
    assert db_session.query(AudioGuideSession).count() == 0
