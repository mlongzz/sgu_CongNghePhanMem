"""Persist rotating refresh sessions and bounded login windows."""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'


def upgrade():
    op.create_table('auth_refresh_sessions',
                    sa.Column('id', sa.String(36), primary_key=True),
                    sa.Column('user_id', sa.Integer, sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
                    sa.Column('token_hash', sa.String(64), nullable=False),
                    sa.Column('expires_at', sa.Integer, nullable=False))
    op.create_index('ix_auth_refresh_sessions_expires_at', 'auth_refresh_sessions', ['expires_at'])
    op.create_table('auth_login_attempts',
                    sa.Column('key', sa.String(64), primary_key=True),
                    sa.Column('attempts', sa.Integer, nullable=False),
                    sa.Column('expires_at', sa.Integer, nullable=False))
    op.create_index('ix_auth_login_attempts_expires_at', 'auth_login_attempts', ['expires_at'])


def downgrade():
    raise RuntimeError('Preserve session revocation state; use a reviewed backup for rollback')
