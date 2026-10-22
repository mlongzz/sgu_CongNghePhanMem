const http = require('node:http');
const { chromium } = require('@playwright/test');
(async () => {
  const server = http.createServer((_, res) => res.end('<!doctype html><title>Multilingual Guide Wikipedia diagnostic</title>'));
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const url = new URL('https://vi.wikipedia.org/w/api.php');
      // Public landmark test coordinate, independent of the user's private GPS.
      url.search = new URLSearchParams({ action: 'query', list: 'geosearch', gscoord: '10.7764|106.6993', gsradius: '5000', gslimit: '50', gsnamespace: '0', format: 'json', formatversion: '2', origin: '*' });
      const started = Date.now();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000), credentials: 'omit' });
        const body = await response.json();
        return { status: response.status, ms: Date.now() - started, count: body.query?.geosearch?.length, error: body.error, examples: body.query?.geosearch?.slice(0, 8) };
      } catch (error) { return { ms: Date.now() - started, error: error.message }; }
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
