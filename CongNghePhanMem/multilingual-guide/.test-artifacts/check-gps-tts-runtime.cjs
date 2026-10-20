// Read-only runtime checks against the developer's real local frontend/backend.
// No account login, no device GPS, no mock POI and no Overpass call.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.runtimeSpeechEvents = [];
      const original = window.speechSynthesis?.speak.bind(window.speechSynthesis);
      if (original) window.speechSynthesis.speak = utterance => {
        utterance.addEventListener('start', () => window.runtimeSpeechEvents.push({ type: 'start' }));
        utterance.addEventListener('error', event => window.runtimeSpeechEvents.push({ type: 'error', code: event.error }));
        return original(utterance);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:8081/place/db-2', { timeout: 60000 });
    await expect(page.getByText('Chợ Bình Tây', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('narration-text')).not.toBeEmpty();
    await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
    const publishedText = await page.getByTestId('narration-text').textContent();
    const voiceState = await page.evaluate(async () => {
      if (!('speechSynthesis' in window)) return { supported: false, languages: [] };
      speechSynthesis.getVoices();
      await new Promise(resolve => setTimeout(resolve, 1200));
      return { supported: true, languages: [...new Set(speechSynthesis.getVoices().map(voice => voice.lang))] };
    });
    await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
    await page.waitForTimeout(1800);
    const playback = {
      stopButton: await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).count(),
      alerts: await page.getByRole('alert').allTextContents(),
      audibleSoundVerified: false,
      speechEvents: await page.evaluate(() => window.runtimeSpeechEvents),
    };
    if (playback.stopButton) await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).click();
    // A public article title is sent for this one live read check, never a user's GPS.
    const wikipedia = await page.evaluate(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const params = new URLSearchParams({ action: 'query', titles: 'Chợ Bình Tây', prop: 'extracts|coordinates|pageprops|langlinks', exintro: '1', explaintext: '1', redirects: '1', format: 'json', formatversion: '2', origin: '*' });
        const response = await fetch(`https://vi.wikipedia.org/w/api.php?${params}`, { credentials: 'omit', signal: controller.signal });
        const body = await response.json();
        const article = body.query?.pages?.[0];
        return { status: response.status, title: article?.title, pageId: article?.pageid, extractCharacters: article?.extract?.length ?? 0, coordinatesAvailable: !!article?.coordinates?.length };
      } catch (error) { return { success: false, error: error.message }; }
      finally { clearTimeout(timer); }
    });
    await page.screenshot({ path: '.test-artifacts/gps-tts-real-postgres.png', fullPage: true });
    let wikiDetail = null;
    if (wikipedia.pageId) {
      await page.goto(`http://localhost:8081/place/wiki-vi-${wikipedia.pageId}`, { timeout: 30000 });
      await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
      await expect(page.getByTestId('narration-attribution')).toContainText('CC BY-SA 4.0');
      const text = await page.getByTestId('narration-text').textContent();
      await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
      await page.waitForTimeout(1200);
      wikiDetail = { url: page.url(), contentCharacters: text.length, sourceAttribution: true,
        stopButton: await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).count(),
        alerts: await page.getByRole('alert').allTextContents(),
        speechEvents: await page.evaluate(() => window.runtimeSpeechEvents), audibleSoundVerified: false };
      if (wikiDetail.stopButton) await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).click();
      await page.screenshot({ path: '.test-artifacts/gps-tts-real-wikipedia.png', fullPage: true });
    }
    const result = { realPostgreSQL: true, publishedGuideCharacters: publishedText.length, deviceGPSRequested: false, voiceState, playback, wikipedia, wikiDetail, pageErrors: errors };
    fs.writeFileSync('.test-artifacts/gps-tts-runtime.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
