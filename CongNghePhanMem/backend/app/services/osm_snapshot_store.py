"""Durable optional OSM snapshots. Public readers SELECT only; explicit sync owns writes.

Uses the existing internal AdminSetting JSON store, never Place/user rows. No migration.
"""
import json
import threading
import time
from uuid import uuid4
from sqlalchemy.exc import IntegrityError
from app.models.admin import AdminSetting

SNAPSHOT_KEY='osm_snapshot_v2'
SYNC_KEY='osm_snapshot_sync_v1'
MAX_BYTES=16*1024*1024


class SnapshotStoreError(RuntimeError):
    pass


class PostgresSnapshotStore:
    def __init__(self,session_factory=None,clock=time.time,read_interval=30):
        if session_factory is None:
            from app.database import SessionLocal
            session_factory=SessionLocal
        self.sessions=session_factory;self.clock=clock;self.read_interval=read_interval
        self._lock=threading.RLock();self._next_read=0;self._memo=None;self._failed=False

    def read(self):
        with self._lock:
            now=self.clock()
            if now<self._next_read:
                if self._failed:raise SnapshotStoreError('Durable OSM snapshot temporarily unavailable')
                return self._memo
            self._next_read=now+self.read_interval
            try:
                with self.sessions() as db:
                    row=db.get(AdminSetting,SNAPSHOT_KEY)
                    value=row.value if row else None
                    if value is not None:
                        if not isinstance(value,dict) or value.get('version')!=1 or not isinstance(value.get('revision'),str) or not isinstance(value.get('snapshot'),dict):raise ValueError()
                        if len(json.dumps(value,allow_nan=False).encode())>MAX_BYTES:raise ValueError()
                        self._memo=(value['revision'],value['snapshot'])
                    else:self._memo=None
                self._failed=False
                return self._memo
            except Exception:
                self._failed=True
                raise SnapshotStoreError('Durable OSM snapshot temporarily unavailable') from None

    def write(self,snapshot):
        if not isinstance(snapshot,dict) or snapshot.get('version')!=2 or not isinstance(snapshot.get('entries'),list):raise SnapshotStoreError('Invalid OSM snapshot')
        value={'version':1,'revision':uuid4().hex,'saved_at':self.clock(),'snapshot':snapshot}
        if len(json.dumps(value,allow_nan=False).encode())>MAX_BYTES:raise SnapshotStoreError('OSM snapshot exceeds storage limit')
        try:
            with self.sessions() as db:
                row=db.query(AdminSetting).filter_by(key=SNAPSHOT_KEY).with_for_update().first()
                if row is None:row=AdminSetting(key=SNAPSHOT_KEY);db.add(row)
                row.value=value;db.commit()
            with self._lock:
                self._memo=(value['revision'],snapshot);self._failed=False;self._next_read=0
        except Exception:
            raise SnapshotStoreError('OSM snapshot was not persisted; previous snapshot retained') from None

    def acquire_sync(self,interval=3600,lease_seconds=300):
        if interval<3600 or lease_seconds<120:raise ValueError('OSM sync interval must be at least 3600 seconds')
        now=self.clock();owner=uuid4().hex
        try:
            with self.sessions() as db:
                row=db.query(AdminSetting).filter_by(key=SYNC_KEY).with_for_update().first()
                if row is None:row=AdminSetting(key=SYNC_KEY,value={});db.add(row)
                state=row.value or {}
                retry=max(state.get('lease_until',0),state.get('next_allowed_at',0))-now
                if retry>0:return None,max(1,int(retry)+1)
                row.value={'owner':owner,'started_at':now,'lease_until':now+lease_seconds,'next_allowed_at':now+interval,'status':'running'}
                db.commit()
            return owner,0
        except IntegrityError:
            return None,interval
        except Exception:
            raise SnapshotStoreError('Cannot acquire durable OSM sync lease') from None

    def finish_sync(self,owner,status,retry_after=0):
        try:
            with self.sessions() as db:
                row=db.query(AdminSetting).filter_by(key=SYNC_KEY).with_for_update().first()
                if row and row.value.get('owner')==owner:
                    row.value={**row.value,'lease_until':0,'finished_at':self.clock(),
                               'next_allowed_at':max(row.value.get('next_allowed_at',0),self.clock()+max(0,retry_after)),
                               'status':'ok' if status=='ok' else 'failed'};db.commit()
        except Exception:
            raise SnapshotStoreError('OSM sync lease will expire automatically') from None

    def status(self):
        try:
            with self.sessions() as db:
                row=db.get(AdminSetting,SNAPSHOT_KEY);lease=db.get(AdminSetting,SYNC_KEY)
                value=row.value if row else {};state=lease.value if lease else {}
                snapshot=value.get('snapshot',{})
                return {'storage':'postgres','available':bool(row),'saved_at':value.get('saved_at'),'regions':len(snapshot.get('entries',[])),
                        'last_sync_status':state.get('status','never'),'next_allowed_at':state.get('next_allowed_at'),'lease_until':state.get('lease_until')}
        except Exception:
            raise SnapshotStoreError('Durable OSM status unavailable') from None
