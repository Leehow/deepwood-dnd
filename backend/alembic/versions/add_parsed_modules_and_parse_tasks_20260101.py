"""add_parsed_modules_and_parse_tasks

Revision ID: a1b2c3d4e5f6
Revises: cb9686fb8e76
Create Date: 2026-01-01 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'cb9686fb8e76'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create parsed_modules table
    op.create_table(
        'parsed_modules',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('module_id', sa.String(100), unique=True, nullable=False),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('title_en', sa.String(500), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('chapters_count', sa.Integer(), server_default='0'),
        sa.Column('monsters_count', sa.Integer(), server_default='0'),
        sa.Column('items_count', sa.Integer(), server_default='0'),
        sa.Column('images_count', sa.Integer(), server_default='0'),
        sa.Column('source_file_id', sa.String(100), nullable=True),
        sa.Column('data_file', sa.String(500), nullable=True),
        sa.Column('created_by', sa.String(100), nullable=False),
        sa.Column('is_shared', sa.Boolean(), server_default='false'),
        sa.Column('original_module_id', sa.String(100), nullable=True),
        sa.Column('parsed_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index('ix_parsed_modules_id', 'parsed_modules', ['id'])
    op.create_index('ix_parsed_modules_module_id', 'parsed_modules', ['module_id'])
    op.create_index('ix_parsed_modules_created_by', 'parsed_modules', ['created_by'])
    op.create_index('ix_parsed_modules_is_shared', 'parsed_modules', ['is_shared'])

    # Create module_parse_tasks table
    op.create_table(
        'module_parse_tasks',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('task_id', sa.String(100), unique=True, nullable=False),
        sa.Column('file_id', sa.String(100), nullable=False),
        sa.Column('status', sa.String(50), server_default='pending'),
        sa.Column('progress', sa.Integer(), server_default='0'),
        sa.Column('current_step', sa.String(100), nullable=True),
        sa.Column('current_message', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('steps_completed', sa.JSON(), server_default='[]'),
        sa.Column('batch_messages', sa.JSON(), server_default='[]'),
        sa.Column('module_id', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index('ix_module_parse_tasks_id', 'module_parse_tasks', ['id'])
    op.create_index('ix_module_parse_tasks_task_id', 'module_parse_tasks', ['task_id'])
    op.create_index('ix_module_parse_tasks_file_id', 'module_parse_tasks', ['file_id'])
    op.create_index('ix_module_parse_tasks_status', 'module_parse_tasks', ['status'])


def downgrade() -> None:
    # Drop module_parse_tasks
    op.drop_index('ix_module_parse_tasks_status', 'module_parse_tasks')
    op.drop_index('ix_module_parse_tasks_file_id', 'module_parse_tasks')
    op.drop_index('ix_module_parse_tasks_task_id', 'module_parse_tasks')
    op.drop_index('ix_module_parse_tasks_id', 'module_parse_tasks')
    op.drop_table('module_parse_tasks')

    # Drop parsed_modules
    op.drop_index('ix_parsed_modules_is_shared', 'parsed_modules')
    op.drop_index('ix_parsed_modules_created_by', 'parsed_modules')
    op.drop_index('ix_parsed_modules_module_id', 'parsed_modules')
    op.drop_index('ix_parsed_modules_id', 'parsed_modules')
    op.drop_table('parsed_modules')
