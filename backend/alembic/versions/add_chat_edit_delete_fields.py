"""Add edit/delete fields to campaign_chat_messages

Revision ID: add_chat_edit_delete_fields
Revises: add_campaign_chat_messages
Create Date: 2025-11-07 22:10:00

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "add_chat_edit_delete_fields"
down_revision = "add_campaign_chat_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add updated_at, is_deleted, deleted_at columns
    op.add_column(
        "campaign_chat_messages",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("NOW()")),
    )
    op.add_column(
        "campaign_chat_messages",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "campaign_chat_messages",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )



def downgrade() -> None:
    op.drop_column("campaign_chat_messages", "deleted_at")
    op.drop_column("campaign_chat_messages", "is_deleted")
    op.drop_column("campaign_chat_messages", "updated_at")

