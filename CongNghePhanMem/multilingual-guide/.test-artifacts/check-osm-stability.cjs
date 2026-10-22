// Read-only diagnostic at a public landmark; no device GPS or credentials.
const fs = require('node:fs');
async function read(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(40000), headers: { Origin: 'http://localhost:8081' }, ...options });
  const body = await response.json();
  return { ms: Date.now() - started, status: response.status, cors: response.headers.get('access-control-allow-origin'), body };
}
(async () => {
  const url = 'http://127.0.0.1:8000/osm/nearby?latitude=10.7764&longitude=106.6993&radius_km=3';
  const first = await read(url);
  const result = { publicLandmarkOnly: true, forceRefresh: false, first };
  if (first.status === 200) result.cached = await read(url);
  fs.writeFileSync('.test-artifacts/osm-stability-live.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, (key, value) => key === 'elements' ? { count: value.length } : value, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
