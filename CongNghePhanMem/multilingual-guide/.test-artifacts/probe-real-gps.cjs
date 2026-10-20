// Real browser geolocation: deliberately does not use setGeolocation or a mock provider.
// Coordinates stay in the browser; the report only records availability, accuracy and errors.
const http = require('node:http');
const fs = require('node:fs');
const ts = require('typescript');
const { chromium } = require('@playwright/test');

(async () => {
  const server = http.createServer((_, response) => response.end('<!doctype html><title>GPS diagnostic</title>'));
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: process.argv.includes('--edge') ? 'msedge' : 'chrome', headless: true,
      ignoreDefaultArgs: process.argv.includes('--normal-networking') ? ['--disable-background-networking'] : [] });
    const context = await browser.newContext({ permissions: ['geolocation'] });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const source = process.argv.includes('--helper') ? ts.transpileModule(fs.readFileSync('src/services/location.web.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText : '';
    const result = await page.evaluate(async ({ source, highAccuracy }) => {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      const started = Date.now();
      const environment = { realGeolocation: true, mockedCoordinates: false, secure: window.isSecureContext, permission: permission.state };
      const requests = [];
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (success, error, options) => {
        requests.push(options);
        original(success, error, options);
      };
      if (source) {
        const exports = {};
        new Function('exports', 'require', source)(exports, () => ({}));
        try {
          await exports.getCurrentCoordinates();
          return { ...environment, success: true, ms: Date.now() - started, requests };
        } catch (error) {
          return { ...environment, success: false, ms: Date.now() - started, error: error.message, code: error.code, requests };
        }
      }
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ ...environment, success: false, ms: Date.now() - started, error: 'No browser callback within 45 seconds' }), 45000);
        navigator.geolocation.getCurrentPosition(position => {
          clearTimeout(timer);
          resolve({ ...environment, success: true, ms: Date.now() - started, accuracy: position.coords.accuracy,
            validCoordinates: Number.isFinite(position.coords.latitude) && Number.isFinite(position.coords.longitude), requests });
        }, error => {
          clearTimeout(timer);
          resolve({ ...environment, success: false, ms: Date.now() - started, code: error.code, error: error.message, requests });
        }, { enableHighAccuracy: highAccuracy, timeout: 40000, maximumAge: 300000 });
      });
    }, { source, highAccuracy: process.argv.includes('--high') });
    const report = { browser: process.argv.includes('--edge') ? 'edge' : 'chrome', version: browser.version(), normalNetworking: process.argv.includes('--normal-networking'), ...result, consoleErrors };
    fs.writeFileSync(`.test-artifacts/real-gps-${report.browser}${source ? '-helper' : ''}${process.argv.includes('--high') ? '-high' : ''}${report.normalNetworking ? '-normal-networking' : ''}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
