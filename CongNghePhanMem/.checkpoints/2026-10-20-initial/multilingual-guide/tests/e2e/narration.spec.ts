import { test, expect, type Page } from '@playwright/test';
import { osmPayload } from './osm-fixture';

// All coordinates, articles and voices in this file are explicitly simulated fixtures.
const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const title = 'Wikipedia Narration Regression';
const excerpts = {
  vi: 'Đây là nội dung giới thiệu địa danh từ bài viết Wikipedia dành cho kiểm thử.',
  en: 'This is the English introduction from the linked Wikipedia article for this landmark.',
  fr: 'Voici la présentation française du lieu dans son article Wikipédia correspondant.',
  ja: 'これはこの場所のウィキペディア記事にある日本語の紹介文です。',
};
declare global {
  interface Window {
    narrationMock: { calls: { text: string; language: string; rate: number }[]; current: SpeechSynthesisUtterance | null; cancels: number; voices: SpeechSynthesisVoice[] };
    autoGps: { callback: PositionCallback | null; error: PositionErrorCallback | null; cleared: number[] };
  }
}
async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    // Mock the utterance as well as the voice list: Chrome's native setter only accepts real OS SpeechSynthesisVoice instances.
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      text: string;
      constructor(text: string) { this.text = text; }
    } });
    window.narrationMock = { calls: [], current: null, cancels: 0, voices: ['vi-VN', 'en-US', 'fr-FR', 'ja-JP'].map(lang => ({ lang, voiceURI: `fixture-${lang}`, name: `fixture-${lang}`, default: false, localService: true })) };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => window.narrationMock.voices,
      speak: (utterance: SpeechSynthesisUtterance) => {
        const state = window.narrationMock; state.current = utterance;
        state.calls.push({ text: utterance.text, language: utterance.lang, rate: utterance.rate });
        setTimeout(() => { if (state.current === utterance) utterance.onstart?.call(utterance, new Event('start') as SpeechSynthesisEvent); }, 0);
      },
      cancel: () => { window.narrationMock.cancels++; window.narrationMock.current = null; },
      pause: () => { const u = window.narrationMock.current; u?.onpause?.call(u, new Event('pause') as SpeechSynthesisEvent); },
      resume: () => { const u = window.narrationMock.current; u?.onresume?.call(u, new Event('resume') as SpeechSynthesisEvent); },
    } });
  });
}
async function wikipedia(page: Page, options: { fail?: () => boolean; empty?: boolean; noEnglish?: boolean; long?: boolean; delayed?: Promise<void> } = {}) {
  await page.route('https://*.wikipedia.org/w/api.php?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === 'geosearch') return route.fulfill({ json: { query: { geosearch: [{ pageid: 456, ns: 0, title, lat: origin.latitude, lon: origin.longitude }] } } });
    if (options.delayed) await options.delayed;
    if (options.fail?.()) return route.fulfill({ status: 503, body: 'fixture unavailable' });
    const lang = url.hostname.split('.')[0] as keyof typeof excerpts;
    return route.fulfill({ json: { query: { pages: [{ pageid: lang === 'vi' ? 456 : 457, ns: 0, title: lang === 'vi' ? title : `${title} ${lang}`,
      extract: options.empty ? '' : `<b>${excerpts[lang]}</b> [12] https://example.invalid/reference ${options.long ? excerpts[lang].repeat(35) : ''}`,
      coordinates: [{ lat: origin.latitude, lon: origin.longitude, globe: 'earth' }],
      langlinks: (['en', 'fr', 'ja'] as const).filter(key => !(options.noEnglish && key === 'en')).map(key => ({ lang: key, title: `${title} ${key}` })),
    }] } } });
  });
}
async function openWikipedia(page: Page) {
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByLabel(`Chi tiết ${title}`, { exact: true })).toBeVisible();
  await page.getByLabel(`Chi tiết ${title}`, { exact: true }).click();
  await expect(page).toHaveURL(/\/place\/wiki-vi-456$/);
}
test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 503, json: { detail: 'Optional fixture unavailable' } }));
  await mockSpeech(page);
});

test('regression: GPS Wikipedia marker opens detail and reads real extract with attribution; pause/resume/stop/reload work', async ({ page }) => {
  const writes: string[] = []; const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/(history|favorites|audio-sessions)/.test(request.url())) writes.push(request.url()); });
  await wikipedia(page); await openWikipedia(page);
  await expect(page.getByTestId('narration-text')).toHaveText(excerpts.vi);
  await expect(page.getByTestId('narration-attribution')).toContainText('CC BY-SA 4.0');
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls)).toEqual([{ text: excerpts.vi, language: 'vi-VN', rate: 1 }]);
  await page.getByRole('button', { name: 'Tạm dừng thuyết minh', exact: true }).click();
  await expect(page.getByText(/Đang tạm dừng/)).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp tục thuyết minh', exact: true }).click();
  await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByTestId('narration-text')).toHaveText(excerpts.vi);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('four languages select translated article text and matching voice/rate; changing language stops playback', async ({ page }) => {
  await wikipedia(page); await openWikipedia(page);
  const choices = [['vi', 'Tiếng Việt', 'vi-VN'], ['en', 'English', 'en-US'], ['fr', 'Français', 'fr-FR'], ['ja', '日本語', 'ja-JP']] as const;
  for (const [lang, label, locale] of choices) {
    await page.getByRole('radio', { name: label, exact: true }).click();
    await expect(page.getByTestId('narration-text')).toHaveText(excerpts[lang]);
    await page.getByRole('button', { name: 'Tốc độ 1.5×', exact: true }).click();
    await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.narrationMock.calls.at(-1))).toEqual({ text: excerpts[lang], language: locale, rate: 1.5 });
  }
  await page.getByRole('button', { name: 'Tốc độ 0.75×', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.narrationMock.current)).toBeNull();
});

test('missing translation and empty content explain disabled playback without speaking metadata', async ({ page }) => {
  await wikipedia(page, { noEnglish: true }); await openWikipedia(page);
  await page.getByRole('radio', { name: 'English', exact: true }).click();
  await expect(page.getByTestId('narration-text')).toHaveText('Địa danh này chưa có nội dung thuyết minh. Vui lòng thử lại sau.');
  await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.narrationMock.calls)).toEqual([]);
});

test('Wikipedia network errors allow retry and missing installed voice explains failure then recovers', async ({ page }) => {
  let fail = true; await wikipedia(page, { fail: () => fail }); await openWikipedia(page);
  await expect(page.getByTestId('narration-text')).toContainText('HTTP 503');
  fail = false;
  await page.getByRole('button', { name: 'Thử tải lại nội dung', exact: true }).click();
  await expect(page.getByTestId('narration-text')).toHaveText(excerpts.vi);
  const installed = await page.evaluate(() => window.narrationMock.voices);
  await page.evaluate(() => { window.narrationMock.voices = window.narrationMock.voices.filter(voice => voice.lang !== 'vi-VN'); });
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('chưa có giọng đọc tiếng Việt');
  expect(await page.evaluate(() => window.narrationMock.calls)).toEqual([]);
  await page.evaluate(voices => { window.narrationMock.voices = voices; }, installed);
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.length)).toBe(1);
});

test('long extract resumes into the next chunk and navigation stops it', async ({ page }) => {
  await wikipedia(page, { long: true }); await openWikipedia(page);
  await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await page.getByRole('button', { name: 'Tạm dừng thuyết minh', exact: true }).click();
  await page.getByRole('button', { name: 'Tiếp tục thuyết minh', exact: true }).click();
  await page.evaluate(() => { const u = window.narrationMock.current; u?.onend?.call(u, new Event('end') as SpeechSynthesisEvent); });
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.length)).toBe(2);
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await expect(page).toHaveURL(/\/map$/);
  expect(await page.evaluate(() => window.narrationMock.current)).toBeNull();
});

test('published PostgreSQL guide and meaningful OSM description both play through the same controls', async ({ page }) => {
  await wikipedia(page);
  await page.goto('/place/db-1');
  await expect(page.getByRole('button', { name: 'Nghe thuyết minh', exact: true })).toBeEnabled();
  const published = await page.getByTestId('narration-text').textContent();
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.at(-1)?.text)).toBe(published);
  await page.getByRole('button', { name: 'Dừng thuyết minh', exact: true }).click();
  const description = 'Đây là mô tả thực tế bằng tiếng Việt của địa điểm từ dữ liệu cộng đồng dùng trong kiểm thử.';
  await page.route('**/osm/nearby?**', route => route.fulfill({ json: osmPayload(route, [{ type: 'node', id: 912, lat: origin.latitude, lon: origin.longitude, tags: { name: 'OSM Narration Fixture', 'description:vi': description } }]) }));
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await page.getByLabel('Chi tiết OSM Narration Fixture', { exact: true }).click();
  await expect(page.getByTestId('narration-text')).toHaveText(description);
  await page.getByRole('button', { name: 'Nghe thuyết minh', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.at(-1)?.text)).toBe(description);
});

test('AutoGuide uses accurate live GPS, avoids repeats, rearms after exit/cooldown, and removes the actual browser watch', async ({ page }) => {
  // Isolate repeat/re-entry behavior for one POI; choosing between multiple sources is tested separately in auto-guide.test.cjs.
  await page.route('https://*.wikipedia.org/w/api.php?**', route => route.fulfill({ json: { query: { geosearch: [] } } }));
  await page.addInitScript(() => {
    window.autoGps = { callback: null, error: null, cleared: [] };
    navigator.geolocation.watchPosition = (success, error) => { window.autoGps.callback = success; window.autoGps.error = error ?? null; return 77; };
    navigator.geolocation.clearWatch = id => { window.autoGps.cleared.push(id); };
  });
  await page.goto('/map');
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  await expect(page.getByLabel('Chi tiết Browser Test Museum', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bật thuyết minh tự động', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Tắt thuyết minh tự động', exact: true })).toBeVisible();
  const emit = async (latitude: number, accuracy = 5) => page.evaluate(({ latitude, accuracy }) => window.autoGps.callback?.({
    coords: { latitude, longitude: 106.6993, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now(),
  } as GeolocationPosition), { latitude, accuracy });
  await emit(origin.latitude, 150);
  expect(await page.evaluate(() => window.narrationMock.calls.length)).toBe(0);
  await emit(origin.latitude);
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.length)).toBe(1);
  for (let i = 0; i < 4; i++) await emit(origin.latitude + i * .000001);
  expect(await page.evaluate(() => window.narrationMock.calls.length)).toBe(1);
  await page.evaluate(() => { const u = window.narrationMock.current; u?.onend?.call(u, new Event('end') as SpeechSynthesisEvent); });
  await emit(origin.latitude);
  expect(await page.evaluate(() => window.narrationMock.calls.length)).toBe(1);
  await emit(origin.latitude + .004);
  await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 120001; });
  await emit(origin.latitude);
  await expect.poll(() => page.evaluate(() => window.narrationMock.calls.length)).toBe(2);
  await page.getByRole('button', { name: 'Tắt thuyết minh tự động', exact: true }).click();
  expect(await page.evaluate(() => window.autoGps.cleared)).toContain(77);
  expect(await page.evaluate(() => window.narrationMock.current)).toBeNull();
  await emit(origin.latitude);
  expect(await page.evaluate(() => window.narrationMock.calls.length)).toBe(2);
});
