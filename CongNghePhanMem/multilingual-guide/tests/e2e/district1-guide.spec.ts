import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

// Real first visit: the product's District 1 mode, with no saved test-harness preference.
test.use({ storageState: { cookies: [], origins: [] } });

const origin = { latitude: 10.7764, longitude: 106.6993, accuracy: 5 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
const geosearch = { query: { geosearch: [
  { pageid: 501, ns: 0, title: 'Chùa Kiểm Thử', lat: origin.latitude, lon: origin.longitude },
  { pageid: 502, ns: 0, title: 'Bảo tàng Chưa Có Ảnh', lat: origin.latitude + 0.001, lon: origin.longitude },
  { pageid: 503, ns: 0, title: 'Phường Kiểm Thử', lat: origin.latitude + 0.002, lon: origin.longitude },
  // War Remnants Museum area, District 3: an attraction with a photo, but outside the app's area.
  { pageid: 504, ns: 0, title: 'Chùa Quận Ba', lat: 10.7795, lon: 106.6921 },
] } };
const photo = 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Pagoda_fixture.jpg';

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route(photo, route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.route('**/osm/nearby?**', route => route.fulfill({ status: 504, body: 'upstream unavailable' }));
  await page.route('**/places/nearby?**', route => route.fulfill({ json: [] }));
  await page.route('https://vi.wikipedia.org/w/api.php?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('list') === 'geosearch') return route.fulfill({ json: geosearch });
    // Lead image only for the pagoda; the museum has no image anywhere; the ward is never looked up.
    return route.fulfill({ json: { query: { pages: params.get('pageids')!.split('|').map(id => id === '501' || id === '504' ? { pageid: 501, ns: 0, pageimage: 'Pagoda_fixture.jpg' } : { pageid: Number(id), ns: 0 }) } } });
  });
  await page.route('https://www.wikidata.org/**', route => route.fulfill({ json: { entities: {} } }));
  await page.route('https://commons.wikimedia.org/w/api.php?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('generator') === 'search') return route.fulfill({ json: { query: { pages: [] } } });
    return route.fulfill({ json: { query: { pages: [{ title: 'File:Pagoda fixture.jpg', imageinfo: [{ thumburl: photo, mime: 'image/jpeg', extmetadata: { Artist: { value: 'Fixture author' }, LicenseShortName: { value: 'CC BY 4.0' } } }] }] } } });
  });
});

test('the District 1 guide shows only attractions with photos inside the district, without radius, filter or hands-free controls', async ({ page }) => {
  await page.goto('/map');
  await expect(page.getByRole('heading', { name: 'Hành trình tối ưu từ vị trí của bạn' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bán kính / })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByText('Trải nghiệm rảnh tay', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Địa điểm Quận 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dùng GPS và tìm địa danh', exact: true }).click();
  const list = page.getByTestId('nearby-place-list');
  await expect(list.getByText('Chùa Kiểm Thử', { exact: true })).toBeVisible();
  await expect(list.getByText('Bảo tàng Chưa Có Ảnh', { exact: true })).toHaveCount(0);
  await expect(list.getByText('Phường Kiểm Thử', { exact: true })).toHaveCount(0);
  await expect(list.getByText('Chùa Quận Ba', { exact: true })).toHaveCount(0);
  // Wikipedia attractions get a real category instead of the generic one.
  await expect(list.getByText('Văn hóa', { exact: true }).first()).toBeVisible();
});

test('an optimal walking route is planned from the visitor GPS through District 1 places', async ({ page }) => {
  const official = (id: number, name: string, latitude: number, longitude: number) => ({ id, name, latitude, longitude, category: 'Văn hóa', publication_status: 'published', image_url: `/media/route-${id}.jpg` });
  await page.route('**/places?limit=100&offset=0', route => route.fulfill({ json: [
    official(1, 'Điểm Xa Nhất', origin.latitude + 0.012, origin.longitude),
    official(2, 'Điểm Gần Nhất', origin.latitude + 0.002, origin.longitude),
    official(3, 'Điểm Ở Giữa', origin.latitude + 0.006, origin.longitude),
    official(4, 'Điểm Quận Ba', 10.7795, 106.6921),
    { ...official(5, 'Điểm Không Ảnh', origin.latitude + 0.004, origin.longitude), image_url: null },
  ] }));
  await page.route('**/media/route-*.jpg', route => route.fulfill({ contentType: 'image/png', body: tile }));
  await page.goto('/map');
  const panel = page.getByTestId('optimal-route');
  await panel.getByRole('radio', { name: 'Tất cả', exact: true }).click();
  await panel.getByRole('button', { name: 'Lập hành trình tối ưu', exact: true }).click();
  await expect(panel.getByText('Xuất phát: vị trí của bạn', { exact: true })).toBeVisible();
  // Only the photographed places inside District 1 are used, nearest-first along the line.
  const stops = panel.getByRole('button', { name: /^Nghe & xem / });
  await expect(stops).toHaveCount(3);
  expect(await stops.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['Nghe & xem Điểm Gần Nhất', 'Nghe & xem Điểm Ở Giữa', 'Nghe & xem Điểm Xa Nhất']);
  await expect(page.locator('.journey-stop-marker')).toHaveCount(3);
  await expect(panel.getByText(/≈ \d+\.\d km/)).toBeVisible();
  await page.context().route('https://www.google.com/maps/**', route => route.fulfill({ contentType: 'text/html', body: '<title>maps</title>' }));
  const popup = page.waitForEvent('popup');
  await panel.getByRole('button', { name: 'Chỉ đường đi bộ trên Google Maps', exact: true }).click();
  const maps = await popup;
  await maps.waitForLoadState();
  const url = new URL(maps.url());
  expect(url.pathname).toBe('/maps/dir/');
  expect(url.searchParams.get('travelmode')).toBe('walking');
  expect(url.searchParams.get('origin')).toBe(`${origin.latitude},${origin.longitude}`);
  await maps.close();
  await panel.getByRole('button', { name: 'Xóa hành trình', exact: true }).click();
  await expect(page.locator('.journey-stop-marker')).toHaveCount(0);
});

test('the hands-free tour asks before each stop, can play early, removes stops and links them with spoken bridges', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { text: string; constructor(text: string) { this.text = text; } } });
    const state = { calls: [] as string[], current: null as SpeechSynthesisUtterance | null };
    Object.assign(window, { tourSpeech: state });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => ['vi-VN', 'en-US'].map(lang => ({ lang, voiceURI: `fixture-${lang}`, name: `fixture-${lang}`, default: false, localService: true })),
      speak: (u: SpeechSynthesisUtterance) => { state.current = u; state.calls.push(u.text); setTimeout(() => { if (state.current === u) u.onstart?.call(u, new Event('start') as SpeechSynthesisEvent); }, 0); },
      cancel: () => { state.current = null; },
      pause: () => {}, resume: () => {},
    } });
  });
  const official = (id: number, name: string, latitude: number) => ({ id, name, latitude, longitude: origin.longitude, category: id === 2 ? 'Lịch sử' : 'Văn hóa', publication_status: 'published', image_url: `/media/route-${id}.jpg` });
  await page.route('**/places?limit=100&offset=0', route => route.fulfill({ json: [official(1, 'Điểm Một', origin.latitude + 0.002), official(2, 'Điểm Hai', origin.latitude + 0.006), official(3, 'Điểm Ba', origin.latitude + 0.012)] }));
  await page.route('**/places/*/guide-content?**', route => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    return route.fulfill({ json: { id: Number(id), place_id: Number(id), language_code: 'vi', title: `Điểm ${id}`, content: `Câu chuyện thuyết minh dành cho địa điểm số ${id} của hành trình.`, publication_status: 'published' } });
  });
  await page.route('**/media/route-*.jpg', route => route.fulfill({ contentType: 'image/png', body: tile }));
  const endOne = () => page.evaluate(() => {
    const state = (window as unknown as { tourSpeech: { current: SpeechSynthesisUtterance | null } }).tourSpeech;
    const u = state.current; state.current = null;
    u?.onend?.call(u, new Event('end') as SpeechSynthesisEvent);
  });
  const spoken = () => page.evaluate(() => (window as unknown as { tourSpeech: { calls: string[] } }).tourSpeech.calls.join(' '));

  await page.goto('/map');
  const panel = page.getByTestId('optimal-route');
  await panel.getByRole('radio', { name: 'Tất cả', exact: true }).click();
  await panel.getByRole('button', { name: 'Lập hành trình tối ưu', exact: true }).click();
  await expect(panel.getByRole('button', { name: /^Nghe & xem / })).toHaveCount(3);
  await panel.getByRole('button', { name: 'Bắt đầu thuyết minh tự động', exact: true }).click();
  const phase = page.getByTestId('tour-phase');
  const tour = page.getByTestId('tour-player');
  // End the spoken chunks one by one until the tour moves on (long scripts are split into several chunks).
  const finishSpeech = async () => {
    const current = await phase.textContent();
    for (let i = 0; i < 30 && (await phase.textContent()) === current; i++) { await endOne(); await page.waitForTimeout(80); }
  };
  await expect(phase).toHaveText('Giới thiệu hành trình');
  await expect.poll(spoken).toContain('Hôm nay chúng ta sẽ ghé 3 điểm');
  await finishSpeech();
  // No GPS check: the visitor is asked to confirm arrival.
  await expect(page.getByRole('heading', { name: 'Bạn chắc chắn đã đến Điểm Một chưa?' })).toBeVisible();
  await tour.getByRole('button', { name: 'Nghe trước khi đến', exact: true }).click();
  await expect.poll(spoken).toContain('địa điểm số 1');
  await finishSpeech();
  await expect(page.getByRole('heading', { name: 'Bạn chắc chắn đã đến Điểm Một chưa?' })).toBeVisible();
  await expect(tour.getByRole('button', { name: 'Đã đến, sang điểm tiếp theo', exact: true })).toBeVisible();
  await tour.getByRole('button', { name: 'Xóa khỏi hành trình Điểm Một', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bạn chắc chắn đã đến Điểm Hai chưa?' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Nghe & xem / })).toHaveCount(2);
  await tour.getByRole('button', { name: 'Tôi đã đến, bắt đầu thuyết minh', exact: true }).click();
  await expect.poll(spoken).toContain('địa điểm số 2');
  await finishSpeech();
  await expect(phase).toHaveText('Đường đến điểm tiếp theo');
  await expect.poll(spoken).toMatch(/Từ lịch sử, chúng ta chuyển sang chủ đề văn hóa\. Điểm dừng cuối cùng là Điểm Ba/);
  await finishSpeech();
  await tour.getByRole('button', { name: 'Tôi đã đến, bắt đầu thuyết minh', exact: true }).click();
  await expect.poll(spoken).toContain('địa điểm số 3');
  await finishSpeech();
  await expect(phase).toHaveText('Kết thúc hành trình');
  await expect.poll(spoken).toContain('Bạn đã ghé 2 trên 2 điểm');
  await finishSpeech();
  await expect(phase).toHaveText('Hành trình đã hoàn thành');
  await expect(page.locator('.journey-stop-marker')).toHaveCount(2);
});
