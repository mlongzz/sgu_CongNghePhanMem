# Backend container release

Schema is managed by Alembic. Follow [the root README](../README.md) before starting
the new image: verify the existing baseline, then run the reviewed migrations.
Startup no longer calls create_all. Run migrations explicitly before serving traffic.

The backend image is published to GitHub Container Registry when a `v*` tag
passes backend SQLite/PostgreSQL, frontend, E2E and Docker build jobs in
[the repository root workflow](https://github.com/mlongzz/sgu_CongNghePhanMem/blob/main/.github/workflows/ci.yml). For example, pushing `v1.0.0` publishes a tagged
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

Place images are normalized with Pillow. Development can use `UPLOAD_DIR`;
production must use durable storage (`MEDIA_STORAGE_BACKEND=r2`, preferably a
custom HTTPS image domain). Local storage is rejected in production. Render Free
does not persist uploaded files across restarts/deploys. All upload, URL import
and source-discovery paths copy through the configured storage, create pending
gallery entries and require separate Admin approval/publication. Configure the
backend-only R2 variables listed in [.env.example](.env.example): account, bucket,
access key ID, secret access key and public HTTPS base URL. Never expose storage
secrets through EXPO_PUBLIC_ variables.

Before upgrading an existing database, run `python -m scripts.check_email_duplicates`
after reviewing a backup. Migration 0006 stops on normalized email collisions and
does not delete/merge accounts. Migration 0007 adds rotating refresh sessions and
database-backed login limits. Old refresh JWTs require one new login. Logout
revokes the refresh family; already issued access tokens remain valid until expiry
(60 minutes by default). Fixed five-minute limits default to 12/account and 120/IP;
the server trusts its connection peer, not a client-provided forwarding header.

No GitHub Actions run, GHCR publish or deployment has been performed by this repair
session. Docker CLI is installed locally but its daemon is unavailable. The root
workflow includes a build check; it still needs a successful run on GitHub.

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

Production snapshots now use `OSM_SNAPSHOT_STORAGE=postgres` (default when
`APP_ENV=production`), in the existing internal AdminSetting JSON store. No new
migration is needed. Public map requests only read snapshots; they never contact
Overpass. Development may still use a local `OSM_CACHE_PATH` file. Production
explicitly rejects ephemeral local snapshots.

Snapshots keep original timestamps, disclose actual coverage/truncation, and are
bounded to 32 regions / 16 MiB. Freshness is 5 minutes (45 seconds for reduced
coverage), with clearly labelled stale fallback for at most 24 hours. Missing,
expired or unreadable optional data never erase official PostgreSQL places.

The separate sync job uses only two fixed public HCMC landmark anchors, not user
GPS. Durable leases prevent overlapping jobs and retain next-allowed time and
provider Retry-After across restarts. Minimum interval is 3600 seconds. Inspect
metadata with Admin-only `GET /admin/osm/status`.

```powershell
python -m scripts.sync_osm  # Preview only: no network/database writes
# Only after approval of the target database and provider access:
python -m scripts.sync_osm --allow-network --apply --once
# Alternative: one dedicated external worker, never API startup:
python -m scripts.sync_osm --allow-network --apply --watch --interval-seconds 3600
```

The job is never launched by map load, startup, seed or deployment. Do not run it
inside a sleeping Render Free web process. Use a separately approved scheduler or
worker. New demo data are also preview-only until an Admin explicitly imports
drafts; nothing is automatically seeded into production.

See [the testing guide](../docs/TESTING_GUIDE.md) and
[acceptance report](../docs/REPAIR_ACCEPTANCE_REPORT.md) for the current handoff,
validation and local commands. No cloud deployment or production database modification was performed.
