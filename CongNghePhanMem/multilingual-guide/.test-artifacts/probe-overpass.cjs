// Read-only probe at a public landmark; does not use the user's location.
const query = '[out:json][timeout:10];nwr(around:1000,10.7764,106.6993)["tourism"="museum"];out center 10;';
(async () => {
  for (const [endpoint, method] of [
    ['https://overpass.private.coffee/api/interpreter', 'GET'],
  ]) {
    const started = Date.now();
    try {
      const encoded = `data=${encodeURIComponent(query)}`;
      const response = await fetch(method === 'GET' ? `${endpoint}?${encoded}` : endpoint, {
        method, signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MultilingualGuide/1.0 (local development POI connectivity diagnostic)', Accept: 'application/json' },
        ...(method === 'POST' ? { body: encoded } : {}),
      });
      const body = await response.text();
      let parsed; try { parsed = JSON.parse(body); } catch {}
      console.log(JSON.stringify({ endpoint, method, status: response.status, ms: Date.now() - started,
        type: response.headers.get('content-type'), server: response.headers.get('server'),
        count: parsed?.elements?.length, examples: parsed?.elements?.slice(0, 2).map(p => p.tags?.name),
        errorExcerpt: response.ok ? undefined : body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 250) }));
    } catch (error) { console.log(JSON.stringify({ endpoint, method, ms: Date.now() - started, error: error.message })); }
  }
})();
