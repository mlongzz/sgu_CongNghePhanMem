"""Add editorial publication, provenance and reversible POI archiving.

Existing POI and guide records retain their published status. No existing rows
are removed or rewritten. New API-created content explicitly starts as draft.
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"


def upgrade():
    with op.batch_alter_table("places") as batch:
        batch.add_column(sa.Column("publication_status", sa.String(12), nullable=False, server_default="published"))
        batch.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True)))
        batch.add_column(sa.Column("source", sa.String(50), nullable=False, server_default="manual"))
        batch.add_column(sa.Column("source_id", sa.String(200)))
        batch.add_column(sa.Column("source_url", sa.String(1000)))
        batch.add_column(sa.Column("source_license", sa.String(200)))
        batch.add_column(sa.Column("image_source_url", sa.String(1000)))
        batch.add_column(sa.Column("image_attribution", sa.String(500)))
        batch.add_column(sa.Column("image_license", sa.String(200)))
        batch.create_check_constraint("ck_places_publication_status", "publication_status IN ('draft', 'published')")
    op.create_index("uq_places_source_identity", "places", ["source", "source_id"], unique=True)
    op.create_index("ix_places_coordinates", "places", ["latitude", "longitude"])
    op.create_index("ix_places_publication", "places", ["publication_status", "deleted_at"])
    with op.batch_alter_table("guide_contents") as batch:
        batch.add_column(sa.Column("publication_status", sa.String(12), nullable=False, server_default="published"))
        batch.add_column(sa.Column("source_url", sa.String(1000)))
        batch.add_column(sa.Column("source_license", sa.String(200)))
        batch.create_check_constraint("ck_guides_publication_status", "publication_status IN ('draft', 'published')")


def downgrade():
    raise RuntimeError("Keep additive columns when rolling back application code; restore a reviewed backup for full rollback")
