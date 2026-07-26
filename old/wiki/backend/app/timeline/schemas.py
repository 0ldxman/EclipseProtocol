from typing import Literal

from pydantic import BaseModel


class TimelineIn(BaseModel):
    record_id: int
    kind: Literal["event", "epoch"] = "event"
    event_date: str
    end_date: str | None = None
    note: str = ""


class TimelinePatch(BaseModel):
    kind: Literal["event", "epoch"] | None = None
    event_date: str | None = None
    end_date: str | None = None
    note: str | None = None


class TimelineSettingsIn(BaseModel):
    current_date: str = ""
    current_label: str = ""
