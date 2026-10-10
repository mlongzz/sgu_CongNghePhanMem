# Backend container release

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
