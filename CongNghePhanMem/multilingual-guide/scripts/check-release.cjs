// Run after `npm run build:web -- --clear`. Uses the actual release export.
// External requests are blocked: this checks layout/hydration, not live providers.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../dist');
const output = path.resolve(__dirname, '../.test-artifacts/release-smoke');
fs.mkdirSync(output, { recursive: true });
const report = { artifact: 'dist', externalRequestsBlocked: true, cases: [], languageChecks: [] };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  let file = path.resolve(root, '.' + name);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (name.startsWith('/place/')) file = path.join(root, 'place', '[id].html');
  else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  else if (!path.extname(file)) file += '.html';
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      for (const route of ['map', 'register']) {
        await page.goto(`${origin}/${route}`, { waitUntil: 'networkidle' });
        if (route === 'map') await page.getByTestId('places-map').waitFor();
        else {
          await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).waitFor();
          await expect(page.getByTestId('auth-form')).toHaveCSS('opacity', '1');
        }
        const diagnostics = await page.getByRole('button', { name: 'Developer Diagnostics', exact: true }).count();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        const screenshot = `release-${route}-${width}.png`;
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true });
        report.cases.push({ route, width, diagnostics, overflow, pageErrors: [...errors], screenshot });
        if (diagnostics || overflow || errors.length) throw new Error(`Release layout failed: ${route}/${width}`);
      }
      if (width === 390) {
        for (const [language, label, authTitle, mapTitle] of [
          ['en', 'English', 'Start your journey', 'Explore around you'],
          ['fr', 'Français', 'Commencez votre voyage', 'Explorez les environs'],
          ['ja', '日本語', '旅を始めましょう', '近くを探索'],
          ['vi', 'Tiếng Việt', 'Bắt đầu hành trình của bạn', 'Khám phá quanh bạn'],
        ]) {
          await page.goto(`${origin}/register`, { waitUntil: 'networkidle' });
          await page.getByRole('button', { name: /^(Chọn ngôn ngữ|Choose language|Choisir la langue|言語を選択)$/ }).click();
          await page.getByRole('dialog').getByRole('radio', { name: label, exact: true }).click();
          await expect(page.getByText(authTitle, { exact: true })).toBeVisible();
          await page.goto(`${origin}/map`, { waitUntil: 'networkidle' });
          await expect(page.getByText(mapTitle, { exact: true })).toBeVisible();
          await page.reload({ waitUntil: 'networkidle' });
          await expect(page.getByText(mapTitle, { exact: true })).toBeVisible();
          expect(errors).toEqual([]);
          report.languageChecks.push({ language, auth: true, map: true, persistedAfterReload: true });
        }
      }
      await context.close();
    }
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = error.message; process.exitCode = 1; }
  finally {
    report.recordedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, languageChecks: report.languageChecks.length }));
  }
})();
