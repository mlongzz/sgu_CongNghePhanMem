"""Acceptance regressions: canonical email, auth sessions, draft routes and query bounds."""
import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from test_admin import client, admin_headers  # noqa: F401
from app.models.user import User
from app.models.place import Place
from app.models.admin import Journey, JourneyStop
from app.routers.auth import create_access_token

PASSWORD = 'TestPassword123!'


def register(client, email='Mixed.Case@Example.com'):
    return client.post('/users', json={'email': email, 'full_name': 'Acceptance', 'password': PASSWORD})


def login(client, email='mixed.case@example.com', password=PASSWORD):
    return client.post('/auth/login', json={'email': email, 'password': password})


def test_email_normalization_login_profile_and_admin(client, admin_headers, db_session):
    created = register(client)
    assert created.status_code == 201 and created.json()['email'] == 'mixed.case@example.com'
    assert register(client, 'MIXED.CASE@example.COM').status_code == 409
    assert login(client, 'MIXED.CASE@EXAMPLE.COM').status_code == 200
    uid = created.json()['id']
    headers = {'Authorization': 'Bearer ' + create_access_token(uid)}
    assert client.put(f'/users/{uid}', headers=headers, json={'email': 'Mixed.Case@example.com'}).status_code == 200
    body = {'email': 'Other@Example.com', 'password': PASSWORD, 'full_name': 'Other'}
    other = client.post('/admin/users', headers=admin_headers, json=body)
    assert other.status_code == 201 and other.json()['email'] == 'other@example.com'
    assert client.post('/admin/users', headers=admin_headers, json={**body, 'email': 'OTHER@example.COM'}).status_code == 409
    assert client.put(f"/admin/users/{other.json()['id']}", headers=admin_headers,
                      json={'email': 'MIXED.case@example.com'}).status_code == 409
    assert client.put(f'/users/{uid}', headers=headers, json={'email': 'OTHER@example.com'}).status_code == 409
    assert client.get('/users/me', headers=headers).json()['email'] == 'mixed.case@example.com'


def test_legacy_mixed_case_account_and_database_uniqueness(client, db_session):
    from app.services.user_service import _password_hash
    db_session.add(User(email='Legacy@Example.com', password_hash=_password_hash.hash(PASSWORD), full_name='Legacy'))
    db_session.commit()
    assert login(client, 'LEGACY@example.com').status_code == 200
    assert register(client, 'legacy@example.com').status_code == 409
    # Bypass all API pre-checks: the database itself must reject an equivalent address.
    db_session.add(User(email=' legacy@example.com ', password_hash='unused', full_name='Duplicate'))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert db_session.query(User).count() == 1


def test_refresh_rotates_once_and_logout_revokes_its_family(client):
    assert register(client).status_code == 201
    first = login(client).json()
    refreshed = client.post('/auth/refresh', json={'refresh_token': first['refresh_token']})
    assert refreshed.status_code == 200
    second = refreshed.json()
    assert second['refresh_token'] != first['refresh_token']
    assert client.post('/auth/refresh', json={'refresh_token': first['refresh_token']}).status_code == 401
    # Logout can win against an in-flight rotation using the previous signed family token.
    assert client.post('/auth/logout', json={'refresh_token': first['refresh_token']}).status_code == 204
    assert client.post('/auth/refresh', json={'refresh_token': second['refresh_token']}).status_code == 401
    assert client.post('/auth/logout', json={'refresh_token': second['refresh_token']}).status_code == 204
    # Explicitly document/test the remaining access-token lifetime.
    headers = {'Authorization': 'Bearer ' + second['access_token']}
    assert client.get('/users/me', headers=headers).status_code == 200
    assert client.get('/admin/me', headers=headers).status_code == 403
    third = login(client).json()
    assert client.post('/auth/refresh', json={'refresh_token': third['refresh_token']}).status_code == 200


def test_forged_and_legacy_refresh_tokens_cannot_create_sessions(client):
    from app.routers.auth import create_refresh_token
    assert register(client).status_code == 201
    assert client.post('/auth/refresh', json={'refresh_token': create_refresh_token(1)}).status_code == 401
    assert client.post('/auth/logout', json={'refresh_token': 'unsigned'}).status_code == 401


def test_login_throttle_and_window_expiry_do_not_reveal_account_existence(client, monkeypatch):
    from app.services import login_throttle
    monkeypatch.setattr(login_throttle, 'ACCOUNT_LIMIT', 2)
    clock = [2_000_000_001]
    monkeypatch.setattr(login_throttle.time, 'time', lambda: clock[0])
    register(client)
    for email in ['mixed.case@example.com', 'missing@example.com']:
        responses = [login(client, email, 'Incorrect123!') for _ in range(3)]
        assert [r.status_code for r in responses] == [401, 401, 429]
        assert responses[0].json()['detail'] == 'Invalid email or password'
        assert 1 <= int(responses[-1].headers['retry-after']) <= 300
    clock[0] += 301
    assert login(client).status_code == 200


def test_unknown_and_wrong_password_both_run_password_verification(client, monkeypatch):
    from app.routers import auth
    register(client)
    calls = []
    monkeypatch.setattr(auth, 'verify_password', lambda password, hashed: calls.append(hashed) or False)
    known = login(client, password='incorrect')
    unknown = login(client, 'absent@example.com', 'incorrect')
    assert known.status_code == unknown.status_code == 401
    assert known.json() == unknown.json() and len(calls) == 2
    assert all(value.startswith('$argon2') for value in calls)


def test_admin_draft_route_publication_archiving_and_empty_route(client, admin_headers):
    def place(name, status):
        result = client.post('/admin/places', headers=admin_headers,
                             json={'name': name, 'latitude': 10, 'longitude': 106, 'publication_status': status})
        assert result.status_code == 201
        return result.json()['id']
    a, draft, b = place('A', 'published'), place('Private draft', 'draft'), place('B', 'published')
    created = client.post('/admin/journeys', headers=admin_headers, json={'name': 'Route', 'place_ids': [b, draft, a]})
    assert created.status_code == 201
    jid = created.json()['id']
    for data in [client.get(f'/journeys/{jid}').json(), client.get('/journeys').json()[0]]:
        assert data['place_ids'] == [b, a]
        assert [p['id'] for p in data['stops']] == [b, a]
        assert 'Private draft' not in str(data)
    assert client.put(f'/admin/places/{draft}', headers=admin_headers, json={'publication_status': 'published'}).status_code == 200
    assert client.get(f'/journeys/{jid}').json()['place_ids'] == [b, draft, a]
    assert client.delete(f'/admin/places/{draft}', headers=admin_headers).status_code == 204
    assert client.put(f'/admin/journeys/{jid}', headers=admin_headers, json={'name': 'Route', 'place_ids': [draft]}).status_code == 422
    assert client.get(f'/journeys/{jid}').json()['place_ids'] == [b, a]
    empty = client.post('/admin/journeys', headers=admin_headers, json={'name': 'Empty', 'place_ids': []}).json()
    assert client.get(f"/journeys/{empty['id']}").json()['stops'] == []
    assert client.get('/journeys/999999').status_code == 404


def test_public_journey_page_has_constant_query_count(client, db_session):
    for number in range(20):
        point = Place(name=f'Point {number}', latitude=10, longitude=106)
        row = Journey(name=f'Route {number}', description='')
        db_session.add_all([point, row]); db_session.flush()
        db_session.add(JourneyStop(journey_id=row.id, place_id=point.id, position=0))
    db_session.commit()
    statements = []
    connection = db_session.connection()
    def capture(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(statement)
    event.listen(connection, 'before_cursor_execute', capture)
    try:
        response = client.get('/journeys?limit=20')
    finally:
        event.remove(connection, 'before_cursor_execute', capture)
    assert response.status_code == 200 and len(response.json()) == 20
    assert len(statements) == 2


def test_email_migration_refuses_duplicates_without_changing_accounts():
    from sqlalchemy import create_engine
    from alembic import command
    from alembic.config import Config
    from scripts.check_email_duplicates import conflicting_account_ids
    engine = create_engine('sqlite://')
    with engine.connect() as connection:
        config = Config('alembic.ini'); config.attributes['connection'] = connection
        command.upgrade(config, '0005')
        connection.execute(text("INSERT INTO users (email,password_hash,full_name) VALUES ('Before@Example.com','hash','First'), ('before@example.com','hash','Second')"))
        assert conflicting_account_ids(connection) == [1, 2]
        with pytest.raises(RuntimeError, match='Duplicate normalized emails'):
            command.upgrade(config, 'head')
        assert connection.execute(text('SELECT count(*) FROM users')).scalar() == 2
        assert connection.execute(text('SELECT version_num FROM alembic_version')).scalar() == '0005'
    engine.dispose()
