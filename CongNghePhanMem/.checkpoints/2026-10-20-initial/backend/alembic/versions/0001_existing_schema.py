"""Immutable baseline for tables previously created by create_all."""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None


def upgrade():
    op.create_table("users", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("email", sa.String(255), nullable=False),
                    sa.Column("password_hash", sa.String(255), nullable=False),
                    sa.Column("full_name", sa.String(100), nullable=False), sa.Column("language", sa.String(10)),
                    sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
                    sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()))
    op.create_index("ix_users_id", "users", ["id"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_table("places", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("name", sa.String(200), nullable=False), sa.Column("description", sa.Text),
                    sa.Column("latitude", sa.Float, nullable=False), sa.Column("longitude", sa.Float, nullable=False),
                    sa.Column("address", sa.String(255)), sa.Column("category", sa.String(100)),
                    sa.Column("image_url", sa.String(500)),
                    sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
                    sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()))
    op.create_index("ix_places_id", "places", ["id"])
    op.create_index("ix_places_name", "places", ["name"])
    for name in ("favorites", "history", "reviews", "guide_contents", "audio_guide_sessions"):
        columns = [sa.Column("id", sa.Integer, primary_key=True)]
        if name != "guide_contents":
            columns.append(sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False))
        columns.append(sa.Column("place_id", sa.Integer, sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False))
        if name == "history":
            columns.append(sa.Column("visited_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
        elif name == "audio_guide_sessions":
            columns.extend([sa.Column("language_code", sa.String(10), nullable=False),
                            sa.Column("progress", sa.Float, nullable=False), sa.Column("completed", sa.Boolean, nullable=False),
                            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())])
        else:
            columns.append(sa.Column("created_at", sa.DateTime(timezone=name != "favorites"),
                                     nullable=name == "favorites", server_default=sa.func.now()))
            if name != "favorites":
                columns.append(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
            if name == "guide_contents":
                columns.extend([sa.Column("language_code", sa.String(10), nullable=False),
                                sa.Column("title", sa.String(200), nullable=False), sa.Column("content", sa.Text, nullable=False),
                                sa.UniqueConstraint("place_id", "language_code", name="uq_place_guide_language")])
            elif name == "reviews":
                columns.extend([sa.Column("rating", sa.Integer, nullable=False, comment="Rating from 1 to 5"), sa.Column("comment", sa.Text),
                                sa.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_review_rating_range"),
                                sa.UniqueConstraint("user_id", "place_id", name="uq_user_place_review")])
            else:
                columns.append(sa.UniqueConstraint("user_id", "place_id", name="uq_user_place_favorite"))
        op.create_table(name, *columns)
        op.create_index(f"ix_{name}_id", name, ["id"])
        for key in (["place_id", "language_code"] if name == "guide_contents" else
                    [] if name == "favorites" else ["user_id", "place_id"]):
            op.create_index(f"ix_{name}_{key}", name, [key])


def downgrade():
    raise RuntimeError("Destructive baseline downgrade disabled; restore a reviewed backup instead")
