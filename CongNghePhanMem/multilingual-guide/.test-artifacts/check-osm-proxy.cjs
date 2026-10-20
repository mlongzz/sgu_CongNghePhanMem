// Public landmark only. Read-only calls to the running development backend.
const fs = require('node:fs');
(async () => {
  const started = Date.now();
  const response = await fetch('http://127.0.0.1:8000/osm/nearby?latitude=10.7764&longitude=106.6993&radius_km=3&force_refresh=true', {
    headers: { Origin: 'http://localhost:8081' }, signal: AbortSignal.timeout(40000),
  });
  const body = await response.json();
  const elapsed = Date.now() - started;
  const auth = await fetch('http://127.0.0.1:8000/users/me', { headers: { Origin: 'http://localhost:8081' }, signal: AbortSignal.timeout(5000) });
  const result = { publicTestLandmark: true, ms: elapsed, status: response.status,
    cors: response.headers.get('access-control-allow-origin'), source: body.source, count: body.elements?.length,
    requestedRadiusKm: body.requested_radius_km, searchedRadiusKm: body.searched_radius_km, warning: body.warning,
    detail: body.detail, examples: body.elements?.slice(0, 4).map(row => row.tags['name:vi'] || row.tags.name),
    unauthenticatedProfile: { status: auth.status, challenge: auth.headers.get('www-authenticate'), cors: auth.headers.get('access-control-allow-origin') } };
  fs.writeFileSync('.test-artifacts/osm-fastapi-live.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
