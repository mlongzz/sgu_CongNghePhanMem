from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class PresenceStart(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: UUID
    device: Literal['web', 'android', 'ios', 'unknown'] = 'unknown'


class PresenceHeartbeat(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    session_id: UUID
    foreground_seconds: float = Field(0, ge=0, le=45)
    interaction_seconds: float = Field(0, ge=0, le=45)

    @model_validator(mode='after')
    def bounded_interaction(self):
        if self.interaction_seconds > self.foreground_seconds:
            raise ValueError('Interaction cannot exceed foreground time')
        return self


class PresenceEnd(PresenceHeartbeat):
    reason: Literal['logout', 'closed'] = 'logout'


class PresencePreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool
