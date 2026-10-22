from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.user import UserCreate


class AdminUserCreate(UserCreate):
    role: Literal["admin", "user"] = "user"


class RoleUpdate(BaseModel):
    role: Literal["admin", "user"]


class ImportApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_token: str = Field(pattern=r"^[a-f0-9]{64}$")


class JourneyWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    place_ids: list[int] = Field(default_factory=list, max_length=100)

    @field_validator("place_ids")
    @classmethod
    def valid_stops(cls, values):
        if any(v <= 0 for v in values) or len(set(values)) != len(values):
            raise ValueError("Stops must be unique positive place IDs")
        return values


class SettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_name: str = Field(default="Multilingual Guide", min_length=1, max_length=100)
    default_language: Literal["vi", "en", "fr", "ja"] = "vi"
    nearby_radius_km: int = Field(default=3, ge=1, le=20)
