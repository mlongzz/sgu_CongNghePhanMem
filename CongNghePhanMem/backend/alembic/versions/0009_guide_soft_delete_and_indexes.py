"""Soft delete for guide contents and indexes for analytics queries."""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'


def upgrade():
    with op.batch_alter_table('guide_contents') as batch:
        batch.add_column(sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_audio_guide_sessions_started_at', 'audio_guide_sessions', ['started_at'])
    op.create_index('ix_history_user_id_visited_at', 'history', ['user_id', 'visited_at'])


def downgrade():
    op.drop_index('ix_history_user_id_visited_at', table_name='history')
    op.drop_index('ix_audio_guide_sessions_started_at', table_name='audio_guide_sessions')
    with op.batch_alter_table('guide_contents') as batch:
        batch.drop_column('deleted_at')
