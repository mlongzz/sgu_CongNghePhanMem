"""Read-only preflight; report conflicting IDs, never delete or merge accounts."""
from sqlalchemy import func, select
from app.database import engine
from app.models.user import User


def conflicting_account_ids(connection):
    canonical = func.lower(func.trim(User.email))
    duplicates = select(canonical).group_by(canonical).having(func.count() > 1)
    return list(connection.execute(select(User.id).where(canonical.in_(duplicates)).order_by(User.id)).scalars())


if __name__ == '__main__':
    with engine.connect() as connection:
        ids = conflicting_account_ids(connection)
    print('Conflicting account IDs: ' + ', '.join(map(str, ids)) if ids else 'No normalized email duplicates')
    raise SystemExit(1 if ids else 0)
