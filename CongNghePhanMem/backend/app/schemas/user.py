"""Pydantic schemas for User endpoints."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class EmailInput(BaseModel):
    @field_validator('email', mode='after', check_fields=False)
    @classmethod
    def canonical_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class UserCreate(EmailInput):
    email: EmailStr
    password: str = Field(
        min_length=8,
        max_length=128,
        description="Password must be at least 8 characters",
    )
    full_name: str = Field(min_length=1, max_length=100)
    language: str = Field(default="vi", min_length=2, max_length=10)


class UserUpdate(EmailInput):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    language: str | None = Field(default=None, min_length=2, max_length=10)

    @model_validator(mode="after")
    def reject_null_for_required_columns(self):
        for field in ("email", "full_name"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class LoginRequest(EmailInput):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str = ""
    token_type: str = "bearer"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    role: str = "user"

    id: int
    email: EmailStr
    full_name: str
    language: str
    created_at: datetime
