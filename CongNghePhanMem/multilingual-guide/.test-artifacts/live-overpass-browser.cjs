// Real Chrome + real service, public landmark only. No mocked OSM response.
const http = require('node:http');
const fs = require('node:fs');
const ts = require('typescript');
const { chromium } = require('@playwright/test');
(async () => {
  const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Multilingual Guide POI diagnostic</title>'); });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const source = ts.transpileModule(fs.readFileSync('src/services/nearby.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const location = { latitude: Number(process.argv[2] ?? 10.7764), longitude: Number(process.argv[3] ?? 106.6993) };
    const radiusKm = Number(process.argv[4] ?? 1);
    const result = await page.evaluate(async ({ source, location, radiusKm }) => {
      const requests = [];
      const liveFetch = window.fetch.bind(window);
      const fetch = async (url, options) => {
        const start = Date.now();
        try {
          const response = await liveFetch(url, options);
          requests.push({ endpoint: url, status: response.status, ms: Date.now() - start });
          return response;
        } catch (error) {
          requests.push({ endpoint: url, error: error.message, ms: Date.now() - start });
          throw error;
        }
      };
      const exports = {};
      const require = () => ({ API_BASE_URL: '' });
      eval(source);
      try {
        const result = await exports.fetchOsmExploreResult(location, radiusKm, { forceRefresh: true });
        return { live: true, location, radiusKm, requests, count: result.places.length, examples: result.places.slice(0, 3).map(p => ({ id: p.id, title: p.title })), warning: result.warning };
      } catch (error) { return { live: false, location, radiusKm, requests, error: error.message }; }
    }, { source, location, radiusKm });
    console.log(JSON.stringify(result, null, 2));
    if (!result.live) process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
