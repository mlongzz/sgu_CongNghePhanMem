"""Enforce the application's case-insensitive email policy without rewriting accounts."""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'


def upgrade():
    connection = op.get_bind()
    duplicate = connection.execute(sa.text(
        'SELECT count(*) FROM users GROUP BY lower(trim(email)) HAVING count(*) > 1 LIMIT 1'
    )).first()
    if duplicate:
        raise RuntimeError('Duplicate normalized emails found. Run python -m scripts.check_email_duplicates; '
                           'review account IDs before migrating. No accounts were changed.')
    expression = 'lower(btrim(email))' if connection.dialect.name == 'postgresql' else 'lower(trim(email))'
    op.create_index('uq_users_email_normalized', 'users', [sa.text(expression)], unique=True)


def downgrade():
    raise RuntimeError('Keep the email uniqueness policy; use a reviewed backup for schema rollback')
