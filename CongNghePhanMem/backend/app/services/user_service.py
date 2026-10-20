"""User service: create, query, verify and update users."""
from sqlalchemy.orm import Session

from app.models.user import User
from pwdlib import PasswordHash

_password_hash = PasswordHash.recommended()


def create_user(db: Session, email: str, password: str, full_name: str, language: str) -> User:
    user = User(
        email=email,
        password_hash=_password_hash.hash(password),
        full_name=full_name,
        language=language,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def verify_password(plain: str, hashed: str) -> bool:
    return _password_hash.verify(plain, hashed)


def update_user(
    db: Session,
    user: User,
    email: str | None = None,
    full_name: str | None = None,
    language: str | None = None,
) -> User:
    if email is not None:
        user.email = email
    if full_name is not None:
        user.full_name = full_name
    if language is not None:
        user.language = language
    db.commit()
    db.refresh(user)
    return user