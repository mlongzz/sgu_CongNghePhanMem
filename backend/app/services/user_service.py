from pwdlib import PasswordHash

from app.models.user import User


password_hash = PasswordHash.recommended()


def create_user(db, email, password, full_name, language):
    hashed_password = password_hash.hash(password)

    user = User(
        email=email,
        password_hash=hashed_password,
        full_name=full_name,
        language=language
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def get_user_by_id(db, user_id):
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db, email):
    return db.query(User).filter(User.email == email).first()


def verify_password(password, password_hash_value):
    return password_hash.verify(
        password,
        password_hash_value
    )
def update_user(
    db,
    user,
    email=None,
    full_name=None,
    language=None
):
    if email is not None:
        user.email = email

    if full_name is not None:
        user.full_name = full_name

    if language is not None:
        user.language = language

    db.commit()
    db.refresh(user)

    return user