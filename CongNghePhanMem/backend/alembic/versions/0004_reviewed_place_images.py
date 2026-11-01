"""Add reviewed image gallery; retain all existing images and records unchanged."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"


def upgrade():
    op.create_table(
        "place_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "place_id",
            sa.Integer(),
            sa.ForeignKey("places.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("source_url", sa.String(1000)),
        sa.Column("attribution", sa.String(500)),
        sa.Column("license", sa.String(200)),
        sa.Column("status", sa.String(12), nullable=False, server_default="pending"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("place_id", "url", name="uq_place_image_url"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_place_image_status",
        ),
    )
    op.create_index("ix_place_images_public", "place_images", ["place_id", "status"])


def downgrade():
    raise RuntimeError(
        "Preserve image approvals and provenance; restore a verified backup for schema rollback"
    )
