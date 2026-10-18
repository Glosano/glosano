"""pick_display_primary: one translation shown where only one fits (FLQ-47 §8)."""

import uuid
from datetime import UTC, datetime, timedelta

from glosano.modules.vocabulary.display import pick_display_primary
from glosano.modules.vocabulary.models import PersonalTranslation

T0 = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
ITEM_ID = uuid.uuid4()


def _row(lang: str, text: str, *, primary: bool, age_days: int) -> PersonalTranslation:
    return PersonalTranslation(
        id=uuid.uuid4(),
        owner_user_id=uuid.uuid4(),
        item_kind="token",
        item_id=ITEM_ID,
        target_language_code=lang,
        translation_text=text,
        is_primary=primary,
        source_type="user",
        created_at=T0 - timedelta(days=age_days),
    )


def test_native_primary_wins_over_newer_foreign_primary() -> None:
    native = _row("uk", "дім", primary=True, age_days=10)
    newer_foreign = _row("ru", "дом", primary=True, age_days=0)

    assert pick_display_primary([newer_foreign, native], "uk") is native


def test_without_native_primary_newest_foreign_primary_is_chosen() -> None:
    old_en = _row("en", "house", primary=True, age_days=5)
    new_ru = _row("ru", "дом", primary=True, age_days=1)
    newest_non_primary = _row("de", "Haus", primary=False, age_days=0)
    native_non_primary = _row("uk", "хата", primary=False, age_days=0)

    chosen = pick_display_primary([old_en, newest_non_primary, new_ru, native_non_primary], "uk")

    assert chosen is new_ru


def test_only_non_primary_rows_give_none() -> None:
    rows = [
        _row("uk", "хата", primary=False, age_days=0),
        _row("ru", "дом", primary=False, age_days=1),
    ]

    assert pick_display_primary(rows, "uk") is None
    assert pick_display_primary([], "uk") is None
