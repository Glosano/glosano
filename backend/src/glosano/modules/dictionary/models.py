"""Dictionary storage (domain model §9, ADR-0004).

Instance-wide, read-only data imported from Wiktionary/Kaikki dumps.
A version row is scoped to one (source_lang, target_lang) pair; at most one
version per pair is `active` (partial unique index). Entries/translations/
examples hang off a version and die with it (ON DELETE CASCADE).

The last two models (user_external_dictionaries, user_dictionary_layouts) are
the exception: they are personal data of one user, cascade on user delete and
are part of the user's JSON export (FLQ-46).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from glosano.core.db import Base


class DictionarySourceVersion(Base):
    __tablename__ = "dictionary_source_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_name: Mapped[str] = mapped_column(String(64))
    source_language_code: Mapped[str] = mapped_column(String(8))
    target_language_code: Mapped[str] = mapped_column(String(8))
    source_version: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), default="importing")  # importing|active|failed
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    __table_args__ = (
        Index(
            "uq_dictionary_versions_active_pair",
            "source_language_code",
            "target_language_code",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )


class DictionaryEntry(Base):
    __tablename__ = "dictionary_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_source_versions.id", ondelete="CASCADE")
    )
    source_language_code: Mapped[str] = mapped_column(String(8))
    headword: Mapped[str] = mapped_column(Text)
    headword_normalized: Mapped[str] = mapped_column(Text)
    part_of_speech: Mapped[str | None] = mapped_column(String(32))
    entry_key: Mapped[str] = mapped_column(Text)
    gloss_summary: Mapped[str | None] = mapped_column(Text)

    translations: Mapped[list[DictionaryTranslation]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DictionaryTranslation.sense_index",
    )
    examples: Mapped[list[DictionaryExample]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="DictionaryExample.sense_index",
    )

    __table_args__ = (
        UniqueConstraint("source_version_id", "entry_key", name="uq_dictionary_entries_key"),
        Index(
            "ix_dictionary_entries_lookup",
            "source_language_code",
            "headword_normalized",
            "source_version_id",
        ),
    )


class DictionaryTranslation(Base):
    __tablename__ = "dictionary_translations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_entries.id", ondelete="CASCADE"), index=True
    )
    target_language_code: Mapped[str] = mapped_column(String(8))
    translation_text: Mapped[str] = mapped_column(Text)
    sense_index: Mapped[int] = mapped_column(Integer, default=0)
    usage_note: Mapped[str | None] = mapped_column(Text)


class DictionaryExample(Base):
    __tablename__ = "dictionary_examples"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dictionary_entries.id", ondelete="CASCADE"), index=True
    )
    sense_index: Mapped[int] = mapped_column(Integer, default=0)
    example_text: Mapped[str] = mapped_column(Text)
    example_translation: Mapped[str | None] = mapped_column(Text)


class UserExternalDictionary(Base):
    """A user's custom URL-template dictionary; NULL pair means "all pairs"."""

    __tablename__ = "user_external_dictionaries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(40))
    url_template: Mapped[str] = mapped_column(String(500))
    source_language_code: Mapped[str | None] = mapped_column(String(8))
    target_language_code: Mapped[str | None] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_user_external_dictionaries_user", "user_id"),
        CheckConstraint(
            "(source_language_code IS NULL) = (target_language_code IS NULL)",
            name="ck_user_external_dictionaries_pair",
        ),
    )


class UserDictionaryLayout(Base):
    """Per-user, per-(source, target) ordering of visible/hidden dictionary ids."""

    __tablename__ = "user_dictionary_layouts"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source_language_code: Mapped[str] = mapped_column(String(8))
    target_language_code: Mapped[str] = mapped_column(String(8))
    visible: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    hidden: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        PrimaryKeyConstraint("user_id", "source_language_code", "target_language_code"),
    )
