// Real Chrome and real service. Default coordinate is a public landmark.
const http = require('node:http');
const fs = require('node:fs');
const ts = require('typescript');
const { chromium } = require('@playwright/test');
(async () => {
  const server = http.createServer((_, res) => res.end('<!doctype html><title>Multilingual Guide Wikipedia service check</title>'));
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const args = { nearby: compile('src/services/nearby.ts'), wiki: compile('src/services/wikipedia.ts'),
      location: { latitude: Number(process.argv[2] ?? 10.7764), longitude: Number(process.argv[3] ?? 106.6993) }, radiusKm: Number(process.argv[4] ?? 5) };
    const result = await page.evaluate(async ({ nearby, wiki, location, radiusKm }) => {
      const nearbyExports = {}; const wikiExports = {};
      new Function('exports', 'require', nearby)(nearbyExports, () => ({ API_BASE_URL: '' }));
      new Function('exports', 'require', wiki)(wikiExports, () => nearbyExports);
      const started = Date.now();
      try {
        const result = await wikiExports.fetchWikipediaNearby(location, radiusKm, { forceRefresh: true });
        return { live: true, ms: Date.now() - started, count: result.places.length, requestedRadiusKm: result.requestedRadiusKm,
          searchedRadiusKm: result.searchedRadiusKm, warning: result.warning,
          examples: result.places.slice(0, 8).map(p => ({ id: p.id, title: p.title, source: p.source, article: p.sourceUrl })) };
      } catch (error) { return { live: false, ms: Date.now() - started, error: error.message }; }
    }, args);
    console.log(JSON.stringify(result, null, 2));
    if (!result.live) process.exitCode = 1;
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
