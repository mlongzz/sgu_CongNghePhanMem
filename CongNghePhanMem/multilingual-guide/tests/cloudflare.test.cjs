const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { scanText, knownServerValues } = require('../scripts/scan-public-bundle.cjs');
test('Worker serves direct Expo routes and preserves 404s for missing code assets', async () => {
  const { default: worker } = await import(pathToFileURL(path.resolve(__dirname, '../cloudflare/worker.mjs')));
  const requested = [];
  const env = { ASSETS: { fetch: async request => { const pathname=new URL(request.url).pathname; requested.push(pathname); return new Response('fixture', { status: pathname === '/index.html' ? 200 : 404, headers: { 'Content-Type': pathname.endsWith('.js') ? 'text/javascript' : 'text/html' } }); } } };
  for (const input of ['/', '/map', '/login/', '/admin', '/journeys', '/saved', '/profile', '/place/db-42', '/place/wiki-vi-7703', '/place/osm-node-123']) {
    const result=await worker.fetch(new Request('https://guide.example'+input),env);
    assert.equal(requested.at(-1),'/index.html');assert.equal(result.status,200);
    assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
  }
  for (const input of ['/missing.js','/place/missing.js','/place/unknown.html','/unknown.css']) {
    const result=await worker.fetch(new Request('https://guide.example'+input),env);
    assert.equal(requested.at(-1),input);assert.equal(result.status,404);
  }
  assert.equal((await worker.fetch(new Request('https://guide.example/login', { method: 'POST' }), env)).status, 405);
});
test('bundle scanner detects server credentials without returning their values', () => {
  const secrets = knownServerValues({ SECRET_KEY: 'private-signing-fixture', R2_SECRET_ACCESS_KEY: 'private-storage-fixture' });
  assert.deepEqual(scanText('const x="private-signing-fixture"', secrets), ['SECRET_KEY']);
  assert.deepEqual(scanText('postgresql://fixture:secret@db.example/database', []), ['DATABASE_CONNECTION_STRING']);
  assert.deepEqual(scanText('https://images.example.org/place.jpg', secrets), []);
});
