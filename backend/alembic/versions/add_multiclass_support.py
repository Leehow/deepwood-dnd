"""Add multiclass support to characters

Revision ID: add_multiclass_support
Revises:
Create Date: 2025-01-14 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
import json


# revision identifiers, used by Alembic.
revision = 'add_multiclass_support'
down_revision = 'fix_campaign_storage_cascade_20251111b'
branch_labels = None
depends_on = None


def upgrade():
    # 添加兼职数据字段
    op.add_column('characters',
        sa.Column('multiclass_data', sa.JSON(), nullable=True)
    )

    # 迁移现有数据到新格式
    connection = op.get_bind()

    # 获取所有现有角色
    result = connection.execute(
        text("SELECT id, class_id, subclass_id, level FROM characters WHERE class_id IS NOT NULL")
    )

    characters = result.fetchall()

    # 为每个角色创建初始的 multiclass_data
    for row in characters:
        multiclass_data = {
            "classes": [{
                "class_id": row.class_id,
                "level": row.level,
                "subclass_id": row.subclass_id
            }],
            "level_history": []
        }

        connection.execute(
            text("UPDATE characters SET multiclass_data = :data WHERE id = :id"),
            {"data": json.dumps(multiclass_data), "id": row.id}
        )


def downgrade():
    # 删除兼职数据字段
    op.drop_column('characters', 'multiclass_data')
