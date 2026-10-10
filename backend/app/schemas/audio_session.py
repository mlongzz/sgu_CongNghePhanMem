from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AudioSessionCreate(BaseModel):
    place_id: int = Field(gt=0)
    language_code: str = Field(min_length=2, max_length=10, pattern=r"^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$")


class AudioSessionUpdate(BaseModel):
    progress: float = Field(ge=0, le=1)
    completed: bool = False

    @model_validator(mode="after")
    def completed_session_must_reach_end(self):
        if self.completed and self.progress < 1:
            raise ValueError("A completed session must have progress equal to 1")
        return self


class AudioSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    place_id: int
    language_code: str
    progress: float
    completed: bool
    started_at: datetime
    updated_at: datetime
