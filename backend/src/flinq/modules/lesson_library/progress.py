"""Прогресс чтения урока для карточки библиотеки (FLQ-8a).

Позиция и остаток новых слов считаются на лету. «Новое слово» — это
отсутствие TokenItem у пары (user, language, token_text), то есть факт,
общий для всех уроков языка: денормализованный счётчик на урок пришлось бы
инвалидировать веером при каждом изменении статуса слова. Обоснование —
docs/superpowers/specs/2026-07-25-library-reading-progress-design.md §3.4.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LessonProgress:
    read_percent: int
    new_words_remaining: int


#: Урок, по которому агрегат не вернул строки (в тексте нет word-like токенов).
ZERO_PROGRESS = LessonProgress(read_percent=0, new_words_remaining=0)


def read_percent(position: int | None, max_ordinal: int | None) -> int:
    """Доля прочитанного, 0..100.

    Зеркало бара ридера (frontend/src/features/reader/ReaderPage.tsx:133-137):
    нет позиции или в уроке нет слов -> 0; урок из одного слова -> 100.
    """
    if position is None or max_ordinal is None:
        return 0
    if max_ordinal == 0:
        return 100
    return max(0, min(100, round(position / max_ordinal * 100)))
