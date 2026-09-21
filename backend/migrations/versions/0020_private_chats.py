"""Private conversations, versioned drafts and independent practice."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0020_private_chats"
down_revision = "0019_youtube_materials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("learning_language_code", sa.String(length=8), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "user_id"),
    )
    op.create_index(
        op.f("ix_chat_conversations_user_id"), "chat_conversations", ["user_id"], unique=False
    )
    op.create_table(
        "chat_drafts",
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("citation_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=True),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("revision >= 0"),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "conversation_id"),
    )
    op.create_index(
        "uq_chat_new_draft",
        "chat_drafts",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("conversation_id IS NULL"),
    )
    op.create_index(op.f("ix_chat_drafts_user_id"), "chat_drafts", ["user_id"], unique=False)
    op.create_table(
        "chat_messages",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("ui_language", sa.String(length=8), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=True),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("role IN ('user', 'assistant')"),
        sa.CheckConstraint("state IN ('complete', 'pending', 'error', 'cancelled')"),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "conversation_id", "user_id"),
    )
    op.create_index(
        op.f("ix_chat_messages_conversation_id"), "chat_messages", ["conversation_id"], unique=False
    )
    op.create_index(op.f("ix_chat_messages_user_id"), "chat_messages", ["user_id"], unique=False)
    op.create_table(
        "chat_citations",
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("lesson_id", sa.Uuid(), nullable=True),
        sa.Column("source_version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("language_code", sa.String(length=8), nullable=False),
        sa.Column("selected_text", sa.Text(), nullable=False),
        sa.Column("context_text", sa.Text(), nullable=False),
        sa.Column("from_ordinal", sa.Integer(), nullable=False),
        sa.Column("to_ordinal", sa.Integer(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("media_start_ms", sa.Integer(), nullable=True),
        sa.Column("media_end_ms", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["message_id", "conversation_id", "user_id"],
            ["chat_messages.id", "chat_messages.conversation_id", "chat_messages.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chat_citations_user_id"), "chat_citations", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_chat_citations_conversation_id"),
        "chat_citations",
        ["conversation_id"],
        unique=False,
    )
    op.create_table(
        "chat_exercises",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("public_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("grading_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('single_choice', 'gap', 'free_response')"),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id", "conversation_id", "user_id"],
            ["chat_messages.id", "chat_messages.conversation_id", "chat_messages.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "conversation_id", "user_id"),
    )
    op.create_index(op.f("ix_chat_exercises_user_id"), "chat_exercises", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_chat_exercises_conversation_id"),
        "chat_exercises",
        ["conversation_id"],
        unique=False,
    )
    op.create_table(
        "chat_attempts",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("exercise_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=True),
        sa.Column("feedback", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("status IN ('complete', 'pending', 'failed')"),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["exercise_id", "conversation_id", "user_id"],
            ["chat_exercises.id", "chat_exercises.conversation_id", "chat_exercises.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "conversation_id", "user_id"),
        sa.UniqueConstraint("user_id", "operation_id"),
    )
    op.create_index(op.f("ix_chat_attempts_user_id"), "chat_attempts", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_chat_attempts_conversation_id"), "chat_attempts", ["conversation_id"], unique=False
    )
    op.create_table(
        "chat_generations",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("partial_text", sa.Text(), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("context_truncated", sa.Boolean(), nullable=False),
        sa.Column("exercise_kind", sa.String(length=24), nullable=True),
        sa.Column("ui_language", sa.String(length=8), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('reply', 'exercise', 'evaluation')"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'complete', 'failed', 'cancelled', 'interrupted')"
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id", "conversation_id", "user_id"],
            ["chat_attempts.id", "chat_attempts.conversation_id", "chat_attempts.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id", "user_id"],
            ["chat_conversations.id", "chat_conversations.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["message_id", "conversation_id", "user_id"],
            ["chat_messages.id", "chat_messages.conversation_id", "chat_messages.user_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "operation_id"),
    )
    op.create_index(
        "uq_chat_active_generation",
        "chat_generations",
        ["conversation_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.create_index(
        op.f("ix_chat_generations_conversation_id"),
        "chat_generations",
        ["conversation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_chat_generations_user_id"), "chat_generations", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_table("chat_generations")
    op.drop_table("chat_attempts")
    op.drop_table("chat_exercises")
    op.drop_table("chat_citations")
    op.drop_table("chat_messages")
    op.drop_table("chat_drafts")
    op.drop_table("chat_conversations")
