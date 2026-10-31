"""Add bounded activity presence and image manager metadata; preserve existing rows."""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'


def upgrade():
    op.create_table('user_presence_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', sa.String(36), nullable=False), sa.Column('device', sa.String(10), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True)), sa.Column('end_reason', sa.String(12)),
        sa.Column('foreground_seconds', sa.Float(), nullable=False, server_default='0'),
        sa.Column('interaction_seconds', sa.Float(), nullable=False, server_default='0'),
        sa.UniqueConstraint('user_id', 'client_id', name='uq_presence_client'),
        sa.CheckConstraint('foreground_seconds >= 0 AND interaction_seconds >= 0 AND interaction_seconds <= foreground_seconds', name='ck_presence_durations'))
    op.create_index('ix_presence_user_seen', 'user_presence_sessions', ['user_id', 'last_seen_at'])
    op.create_index('ix_presence_online', 'user_presence_sessions', ['ended_at', 'last_seen_at', 'expires_at'])
    op.create_index('ix_presence_retention', 'user_presence_sessions', ['last_seen_at'])
    op.create_table('user_presence_preferences',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False))
    op.add_column('places', sa.Column('image_thumbnail_url', sa.String(1000)))
    for column in (
        sa.Column('thumbnail_url', sa.String(1000)), sa.Column('sha256', sa.String(64)),
        sa.Column('width', sa.Integer()), sa.Column('height', sa.Integer()),
        sa.Column('storage_backend', sa.String(12)),
        sa.Column('health_status', sa.String(12), nullable=False, server_default='unknown'),
        sa.Column('health_checked_at', sa.DateTime(timezone=True)), sa.Column('health_error', sa.String(200)),
    ):
        op.add_column('place_images', column)
    op.create_index('uq_place_image_sha256', 'place_images', ['place_id', 'sha256'], unique=True)


def downgrade():
    raise RuntimeError('Destructive downgrade is disabled. Restore a verified backup into a separate database instead.')
