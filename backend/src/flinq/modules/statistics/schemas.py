"""Statistics response contract."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from flinq.core.languages import LearningLanguageCode

Count = Annotated[int, Field(ge=0)]


class Overview(BaseModel):
    language_code: LearningLanguageCode
    date: date
    timezone: Literal["UTC"] = "UTC"
    known_items_count: Count
    tracked_items_count: Count
    ignored_items_count: Count
    tokens_read_today: Count
    new_items_today: Count
    learned_items_today: Count
    reviews_completed_today: Count
    due_reviews: Count
    reading_tracking_started_at: datetime
