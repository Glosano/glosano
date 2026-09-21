"""Keep retry provenance and the original immutable request."""

import sqlalchemy as sa
from alembic import op

revision = "0021_chat_generation_requests"
down_revision = "0020_private_chats"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chat_generations", sa.Column("request_message_id", sa.Uuid(), nullable=True))
    op.add_column("chat_generations", sa.Column("retry_of_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_chat_generation_request",
        "chat_generations",
        "chat_messages",
        ["request_message_id", "conversation_id", "user_id"],
        ["id", "conversation_id", "user_id"],
        ondelete="CASCADE",
    )
    op.execute("""UPDATE chat_generations AS g SET request_message_id = CASE
        WHEN g.kind = 'evaluation' THEN g.message_id
        ELSE (SELECT m.id FROM chat_messages m JOIN chat_messages a ON a.id = g.message_id
          WHERE m.conversation_id = g.conversation_id AND m.role = 'user'
          AND m.created_at <= a.created_at ORDER BY m.created_at DESC, m.id DESC LIMIT 1) END""")


def downgrade():
    op.drop_constraint("fk_chat_generation_request", "chat_generations", type_="foreignkey")
    op.drop_column("chat_generations", "retry_of_id")
    op.drop_column("chat_generations", "request_message_id")
