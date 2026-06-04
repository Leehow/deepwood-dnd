"""Add optimization tracking tables

Revision ID: optimization_001
Revises:
Create Date: 2024-11-20 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ENUM, JSON
from datetime import datetime

# revision identifiers, used by Alembic.
revision = 'optimization_001'
down_revision = None
branch_labels = None
depends_on = None


# Create ENUMs
module_type_enum = ENUM('handler', 'service', 'component', 'route', 'utility', 'model', 'test', name='moduletype', create_type=False)
test_type_enum = ENUM('unit', 'integration', 'e2e', name='testtype', create_type=False)
metric_type_enum = ENUM('fps', 'latency', 'query_count', 'response_time', 'memory_usage', 'cpu_usage', name='metrictype', create_type=False)
environment_enum = ENUM('development', 'staging', 'production', name='environment', create_type=False)
recovery_action_enum = ENUM('retry', 'refresh', 'fallback', 'manual', 'ignore', name='recoveryaction', create_type=False)


def upgrade() -> None:
    # Create ENUMs
    module_type_enum.create(op.get_bind(), checkfirst=True)
    test_type_enum.create(op.get_bind(), checkfirst=True)
    metric_type_enum.create(op.get_bind(), checkfirst=True)
    environment_enum.create(op.get_bind(), checkfirst=True)
    recovery_action_enum.create(op.get_bind(), checkfirst=True)

    # Create code_modules table
    op.create_table('code_modules',
        sa.Column('id', UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column('name', sa.String(255), nullable=False, unique=True),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('line_count', sa.Integer(), nullable=False),
        sa.Column('type', module_type_enum, nullable=False),
        sa.Column('dependencies', JSON(), default=list),
        sa.Column('last_refactored', sa.DateTime(), default=datetime.utcnow),
        sa.Column('original_file', sa.String(500)),
        sa.Column('is_compliant', sa.Boolean(), default=False)
    )

    # Create indexes for code_modules
    op.create_index('ix_code_modules_type', 'code_modules', ['type'])
    op.create_index('ix_code_modules_is_compliant', 'code_modules', ['is_compliant'])
    op.create_index('ix_code_modules_line_count', 'code_modules', ['line_count'])

    # Create test_suites table
    op.create_table('test_suites',
        sa.Column('id', UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column('module_id', UUID(as_uuid=True), sa.ForeignKey('code_modules.id'), nullable=True),
        sa.Column('type', test_type_enum, nullable=False),
        sa.Column('coverage_percent', sa.Float(), default=0.0),
        sa.Column('test_count', sa.Integer(), default=0),
        sa.Column('passing_count', sa.Integer(), default=0),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('last_run', sa.DateTime()),
        sa.Column('execution_time_ms', sa.Integer())
    )

    # Create indexes for test_suites
    op.create_index('ix_test_suites_type', 'test_suites', ['type'])
    op.create_index('ix_test_suites_coverage', 'test_suites', ['coverage_percent'])

    # Create performance_metrics table
    op.create_table('performance_metrics',
        sa.Column('id', UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column('metric_type', metric_type_enum, nullable=False),
        sa.Column('component', sa.String(255), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('unit', sa.String(50), nullable=False),
        sa.Column('threshold', sa.Float()),
        sa.Column('measured_at', sa.DateTime(), default=datetime.utcnow),
        sa.Column('environment', environment_enum, default='development'),
        sa.Column('context', JSON(), default=dict),
        sa.Column('module_id', UUID(as_uuid=True), sa.ForeignKey('code_modules.id'), nullable=True)
    )

    # Create indexes for performance_metrics
    op.create_index('ix_performance_metrics_type', 'performance_metrics', ['metric_type'])
    op.create_index('ix_performance_metrics_component', 'performance_metrics', ['component'])
    op.create_index('ix_performance_metrics_measured_at', 'performance_metrics', ['measured_at'])
    op.create_index('ix_performance_metrics_environment', 'performance_metrics', ['environment'])

    # Create error_recovery_states table
    op.create_table('error_recovery_states',
        sa.Column('id', UUID(as_uuid=True), nullable=False, primary_key=True),
        sa.Column('error_type', sa.String(255), nullable=False),
        sa.Column('component', sa.String(255), nullable=False),
        sa.Column('retry_count', sa.Integer(), default=0),
        sa.Column('max_retries', sa.Integer(), default=3),
        sa.Column('backoff_ms', sa.Integer(), default=100),
        sa.Column('recovery_action', recovery_action_enum, default='retry'),
        sa.Column('context', JSON(), default=dict),
        sa.Column('created_at', sa.DateTime(), default=datetime.utcnow),
        sa.Column('resolved_at', sa.DateTime(), nullable=True)
    )

    # Create indexes for error_recovery_states
    op.create_index('ix_error_recovery_error_type', 'error_recovery_states', ['error_type'])
    op.create_index('ix_error_recovery_component', 'error_recovery_states', ['component'])
    op.create_index('ix_error_recovery_created_at', 'error_recovery_states', ['created_at'])
    op.create_index('ix_error_recovery_resolved', 'error_recovery_states', ['resolved_at'])

    # Create websocket_handlers table
    op.create_table('websocket_handlers',
        sa.Column('message_type', sa.String(100), primary_key=True),
        sa.Column('handler_module', sa.String(255), nullable=False),
        sa.Column('handler_class', sa.String(100), nullable=False),
        sa.Column('avg_processing_ms', sa.Float(), default=0.0),
        sa.Column('message_count', sa.Integer(), default=0),
        sa.Column('error_count', sa.Integer(), default=0),
        sa.Column('last_used', sa.DateTime()),
        sa.Column('batch_capable', sa.Boolean(), default=False)
    )

    # Create indexes for websocket_handlers
    op.create_index('ix_websocket_handlers_last_used', 'websocket_handlers', ['last_used'])
    op.create_index('ix_websocket_handlers_avg_processing', 'websocket_handlers', ['avg_processing_ms'])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_table('websocket_handlers')
    op.drop_table('error_recovery_states')
    op.drop_table('performance_metrics')
    op.drop_table('test_suites')
    op.drop_table('code_modules')

    # Drop ENUMs
    module_type_enum.drop(op.get_bind(), checkfirst=True)
    test_type_enum.drop(op.get_bind(), checkfirst=True)
    metric_type_enum.drop(op.get_bind(), checkfirst=True)
    environment_enum.drop(op.get_bind(), checkfirst=True)
    recovery_action_enum.drop(op.get_bind(), checkfirst=True)