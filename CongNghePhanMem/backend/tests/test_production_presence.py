import importlib.util
from pathlib import Path
from datetime import datetime,timedelta,timezone
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models.user import User
from app.models.presence import UserPresenceSession,UserPresencePreference
from app.services import presence_service as service


def load_production_config(monkeypatch,origin):
    import app.config
    monkeypatch.setenv('APP_ENV','production')
    monkeypatch.setenv('SECRET_KEY','isolated-production-config-test-'+'x'*40)
    monkeypatch.setenv('ALLOWED_ORIGINS',origin)
    spec=importlib.util.spec_from_file_location('production_config_fixture',app.config.__file__)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('origin',['*','http://localhost:8081','https://app.example.com/','https://user:password@app.example.com','https://app.example.com?token=abc','https://app.localhost'])
def test_production_cors_rejects_inexact_or_insecure_origins(monkeypatch,origin):
    with pytest.raises(RuntimeError):load_production_config(monkeypatch,origin)


def test_production_origin_bearer_preflight_and_rbac(monkeypatch):
    from app.routers.presence import router
    origin='https://multilingual-guide.student.workers.dev'
    settings=load_production_config(monkeypatch,origin)
    application=FastAPI();application.include_router(router)
    application.add_middleware(CORSMiddleware,allow_origins=settings.ALLOWED_ORIGINS,allow_methods=['*'],allow_headers=['*'],allow_credentials=True)
    with TestClient(application) as client:
        allowed=client.options('/presence/start',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'})
        assert allowed.status_code==200 and allowed.headers['access-control-allow-origin']==origin
        denied=client.options('/presence/start',headers={'Origin':'https://other.workers.dev','Access-Control-Request-Method':'POST'})
        assert denied.status_code==400 and 'access-control-allow-origin' not in denied.headers
        anonymous=client.get('/admin/presence/summary',headers={'Origin':origin})
        assert anonymous.status_code==401 and anonymous.headers['access-control-allow-origin']==origin


def test_presence_and_opt_out_survive_database_engine_restart(tmp_path):
    url='sqlite:///'+str(tmp_path/'restart.db')
    engine=create_engine(url);Base.metadata.create_all(engine)
    now=datetime.now(timezone.utc)
    with sessionmaker(bind=engine)() as db:
        user=User(email='restart@presence.example',password_hash='fixture',full_name='Restart fixture');db.add(user);db.flush();uid=user.id
        db.add(UserPresencePreference(user_id=uid,enabled=False))
        db.add(UserPresenceSession(user_id=uid,client_id=str(uuid4()),device='ios',started_at=now,last_seen_at=now,expires_at=now+timedelta(hours=24),foreground_seconds=12,interaction_seconds=4));db.commit()
    engine.dispose()
    reopened=create_engine(url)
    with sessionmaker(bind=reopened)() as db:
        assert not service.tracking_enabled(db,uid)
        row=db.query(UserPresenceSession).one()
        assert row.foreground_seconds==12 and row.interaction_seconds==4 and row.device=='ios'
        assert not service.session_value(row,now+timedelta(seconds=91))['online']
    reopened.dispose()
