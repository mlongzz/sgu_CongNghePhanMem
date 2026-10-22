const http = require('node:http');
const { chromium } = require('@playwright/test');
(async () => {
  const server = http.createServer((_, res) => res.end('<!doctype html><title>Multilingual Guide diagnostic</title>'));
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const endpoint = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
      const around = '(around:5000,10.7436,106.635)';
      const query = `[out:json][timeout:12];(nwr${around}["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|artwork)$"];nwr${around}["name"]["historic"];nwr${around}["name"]["leisure"="park"];);out center 250;`;
      const start = Date.now();
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(18000) });
        const body = await response.json();
        return { endpoint, status: response.status, ms: Date.now() - start, count: body.elements?.length, remark: body.remark, examples: body.elements?.slice(0, 5).map(p => ({ type: p.type, id: p.id, name: p.tags?.name })) };
      } catch (error) { return { endpoint, ms: Date.now() - start, error: error.message }; }
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
