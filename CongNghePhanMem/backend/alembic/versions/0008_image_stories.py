"""Per-photo stories: each approved place photo can tell its own short story in vi/en/fr/ja."""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'


def upgrade():
    with op.batch_alter_table('place_images') as batch:
        batch.add_column(sa.Column('story', sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table('place_images') as batch:
        batch.drop_column('story')
