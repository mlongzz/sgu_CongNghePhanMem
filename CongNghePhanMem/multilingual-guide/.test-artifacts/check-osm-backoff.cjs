// Read-only at a public landmark. Follow-up failure requests should not call Overpass.
const fs = require('node:fs');
async function read(radius, force = false) {
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:8000/osm/nearby?latitude=10.7764&longitude=106.6993&radius_km=${radius}${force ? '&force_refresh=true' : ''}`, {
    signal: AbortSignal.timeout(40000), headers: { Origin: 'http://localhost:8081' },
  });
  const body = await response.json();
  return { radius, force, ms: Date.now() - started, status: response.status,
    retryAfter: response.headers.get('retry-after'), cors: response.headers.get('access-control-allow-origin'),
    ...body, elements: body.elements ? { count: body.elements.length } : undefined };
}
(async () => {
  const result = { publicLandmarkOnly: true, first: await read(3) };
  if (result.first.status >= 500 && result.first.retryAfter) {
    result.repeat = await read(3);
    result.changedRadiusForced = await read(5, true);
  }
  fs.writeFileSync('.test-artifacts/osm-backoff-live.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
