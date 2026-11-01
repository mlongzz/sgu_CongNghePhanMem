from pydantic import BaseModel, ConfigDict, Field


class UrlPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2000)


class UrlEdits(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=5000)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    address: str | None = Field(None, max_length=255)
    category: str | None = Field(None, max_length=100)


class UrlImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_token: str = Field(min_length=65, max_length=64000)
    changes: UrlEdits = Field(default_factory=UrlEdits)
