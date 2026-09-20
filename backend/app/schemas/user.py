from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    language: str = "vi"
class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = None
    language: str | None = None
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    language: str
    created_at: datetime

    class Config:
        from_attributes = True
