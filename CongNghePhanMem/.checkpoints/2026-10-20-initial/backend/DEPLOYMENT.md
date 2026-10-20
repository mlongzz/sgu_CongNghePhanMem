# Backend container release

Schema is now managed by Alembic. Follow `../ADMIN_DASHBOARD.md` before starting
the new image: verify the existing baseline, then run the reviewed migrations.
Startup no longer calls create_all. Run migrations explicitly before serving traffic.

The backend image is published to GitHub Container Registry when a `v*` tag
passes the backend test job. For example, pushing `v1.0.0` publishes a tagged
image at `ghcr.io/<owner>/<repository>/backend:1.0.0`.

Set these environment variables on the container host before starting it:

- `DATABASE_URL`: a reachable production database URL. Prefer managed PostgreSQL
  over SQLite for multi-instance deployments.
- `SECRET_KEY`: a private, randomly generated signing key; never use the sample
  value from `.env.example`.
- `ALLOWED_ORIGINS`: comma-separated public frontend origins.
- `ADMIN_USER_IDS`: comma-separated account IDs that can manage places and guide
  content.
- `TRANSLATION_API_URL` and `TRANSLATION_API_KEY`: required only when the admin
  translation action should call a LibreTranslate-compatible provider.

The container listens on port `8000` and exposes `/` as its health check. The
host must provide persistent database storage and inject secrets at runtime.

Place image uploads use Pillow and `UPLOAD_DIR` (default `backend/uploads`).
Mount this directory as persistent storage and include it in backups. Multiple
replicas require shared storage. Image writes require the existing admin role;
public delivery only serves generated UUID filenames.
See `../COMPLETION_REPORT.md` for current validation and remaining release checks.

PostgreSQL is the primary POI source. The reviewed HCMC bundle is imported through
JWT/RBAC Admin endpoints, with an additive transaction and audit log:

```powershell
python -m scripts.import_hcmc          # Offline preview, no writes or login
python -m scripts.import_hcmc --apply  # Hidden local password prompt, real Admin API
```

Only missing places and vi/en/fr/ja guides are added; existing editor content is
preserved. Repeating the import does not duplicate records. The CLI sends no
credentials to third-party providers. No schema migration is needed.

`GET /osm/nearby` now reads a saved snapshot only, including when old clients send
`force_refresh=true`. Opening a map or reading GPS never causes an Overpass call.
`GET /places/nearby` remains PostgreSQL-only. Keep the frontend origin in
`ALLOWED_ORIGINS`; `httpx2` remains a runtime dependency for the optional sync job.

Snapshots live at `OSM_CACHE_PATH` (default `backend/cache/osm-poi-v2.json`,
`/app/cache/osm-poi-v2.json` in the container). Mount `/app/cache` as persistent
storage shared with a single sync worker. The API needs read access; the worker
needs write access. Updates use an atomic file replacement and are reloaded by
API workers without restarting. Only successful provider results replace saved
data. Old/invalid snapshots never replace the official catalog.

Full results are fresh for 5 minutes, reduced results for 45 seconds, and successful
entries are retained up to 24 hours, bounded to 32 entries and 16 MiB on disk.
Nearby GPS fixes share 0.001-degree cells; queries have a 100 m buffer and responses
are filtered from the actual caller coordinates. Reusing a larger synced circle
reports its actual guaranteed coverage. Old results have `stale: true`, their
original age and a warning. If no eligible snapshot exists, the optional endpoint
returns 503 with an explanatory message and `Retry-After`, without outbound work.

The optional job has two fixed public HCMC landmark targets, no device GPS:

```powershell
python -m scripts.sync_osm   # Preview only, zero network requests
# Enable only when external sync is wanted and connectivity is available:
python -m scripts.sync_osm --allow-network --once
python -m scripts.sync_osm --allow-network --watch --interval-seconds 3600
```

It is not started by API startup. Run one worker or schedule `--once` hourly with
overlapping instances disabled. The minimum configured interval is one hour.
Provider timeouts, backup/radius reduction and Retry-After backoff remain bounded.
Sync errors keep the last successful file and never touch PostgreSQL places.
No network-enabled job was launched during this change. See
`../BACKEND_FIRST_REPORT.md` for the real Admin import and validation results.
