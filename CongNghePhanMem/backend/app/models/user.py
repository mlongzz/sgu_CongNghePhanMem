from sqlalchemy import Column, Integer, String, DateTime, Index
from sqlalchemy.sql import func

from app.database import Base
from app.email_policy import canonical_email


class User(Base):
    __tablename__ = "users"

    role = Column(String(10), nullable=False, default="user", server_default="user")

    id = Column(Integer, primary_key=True, index=True)

    email = Column(
        String(255),
        unique=True,
        nullable=False,
        index=True
    )

    password_hash = Column(
        String(255),
        nullable=False
    )

    full_name = Column(
        String(100),
        nullable=False
    )

    language = Column(
        String(10),
        default="vi"
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

    __table_args__ = (Index('uq_users_email_normalized', canonical_email(email), unique=True),)
