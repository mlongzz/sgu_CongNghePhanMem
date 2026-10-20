"""Add persisted roles, journeys, ordered stops, settings and audit records."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"


def create_table(name, *columns):
    """Adopt a compatible table left by legacy create_all without deleting its data."""
    inspector = sa.inspect(op.get_bind())
    if name not in inspector.get_table_names():
        op.create_table(name, *columns)
        return
    actual = {c['name']: c for c in inspector.get_columns(name)}
    expected = {c.name: c for c in columns if isinstance(c, sa.Column)}
    if set(actual) != set(expected):
        raise RuntimeError(f"Existing {name} has incompatible columns; review schema before migrating")
    for key, col in expected.items():
        current = actual[key]
        if (current['type']._type_affinity != col.type._type_affinity or
                getattr(current['type'], 'length', None) != getattr(col.type, 'length', None) or
                (not col.primary_key and current['nullable'] != col.nullable)):
            raise RuntimeError(f"Existing {name}.{key} is incompatible")
    expected_fks = {(col.name, fk.target_fullname, fk.ondelete) for col in expected.values() for fk in col.foreign_keys}
    actual_fks = {(fk['constrained_columns'][0], fk['referred_table'] + '.' + fk['referred_columns'][0],
                   fk.get('options', {}).get('ondelete')) for fk in inspector.get_foreign_keys(name)}
    if expected_fks != actual_fks:
        raise RuntimeError(f"Existing {name} has incompatible foreign keys")
    expected_unique = {tuple(c.columns.keys()) for c in columns if isinstance(c, sa.UniqueConstraint)}
    # Unattached UniqueConstraint columns are resolved via a temporary Table.
    if any(isinstance(c, sa.UniqueConstraint) for c in columns):
        expected_table = sa.Table(name, sa.MetaData(), *columns)
        expected_unique = {tuple(c.columns.keys()) for c in expected_table.constraints if isinstance(c, sa.UniqueConstraint)}
    actual_unique = {tuple(c['column_names']) for c in inspector.get_unique_constraints(name)}
    if not expected_unique <= actual_unique:
        raise RuntimeError(f"Existing {name} is missing a required uniqueness constraint")


def create_index(name, table, columns):
    if name not in {index['name'] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
        op.create_index(name, table, columns)


def upgrade():
    if 'role' not in {c['name'] for c in sa.inspect(op.get_bind()).get_columns('users')}:
        op.add_column("users", sa.Column("role", sa.String(10), nullable=False, server_default="user"))
    create_table("journeys", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("name", sa.String(200), nullable=False), sa.Column("description", sa.Text, nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    create_table("journey_stops", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("journey_id", sa.Integer, sa.ForeignKey("journeys.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("place_id", sa.Integer, sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("position", sa.Integer, nullable=False),
                    sa.UniqueConstraint("journey_id", "position", name="uq_journey_position"))
    create_index("ix_journey_stops_journey_id", "journey_stops", ["journey_id"])
    create_table("audit_logs", sa.Column("id", sa.Integer, primary_key=True),
                    sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
                    sa.Column("action", sa.String(20), nullable=False), sa.Column("resource", sa.String(80), nullable=False),
                    sa.Column("resource_id", sa.Integer),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    create_table("admin_settings", sa.Column("key", sa.String(80), primary_key=True), sa.Column("value", sa.JSON, nullable=False))


def downgrade():
    raise RuntimeError("Destructive downgrade disabled; restore a reviewed backup instead")
