import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
const api = 'http://127.0.0.1:8765';
const password = 'TestPassword123!';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
let createdPlaces: number[] = [], createdJourneys: number[] = [];

declare global {
  interface Window {
    acceptanceSpeech: { calls: string[]; current: SpeechSynthesisUtterance | null };
  }
}
async function speech(page: Page) {
  await page.addInitScript(() => {
    window.acceptanceSpeech = { calls: [], current: null };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ lang: 'vi-VN', voiceURI: 'fixture-vi', name: 'fixture-vi', localService: true }],
      speak: (u: SpeechSynthesisUtterance) => { window.acceptanceSpeech.current = u; window.acceptanceSpeech.calls.push(u.text); setTimeout(() => u.onstart?.call(u, new Event('start') as SpeechSynthesisEvent), 0); },
      cancel: () => { window.acceptanceSpeech.current = null; },
    } });
  });
}
async function token(request: APIRequestContext) {
  const result = await request.post(`${api}/auth/login`, { data: { email: 'admin@e2e.example.com', password } });
  expect(result.status()).toBe(200);
  return (await result.json()).access_token as string;
}
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  createdPlaces = []; createdJourneys = [];
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({contentType:'image/png',body:pixel}));
  await page.route('https://upload.wikimedia.org/**', route => route.fulfill({contentType:'image/png',body:pixel}));
});
test.afterEach(async ({ request }) => {
  if (!createdPlaces.length && !createdJourneys.length) return;
  const headers = {Authorization:`Bearer ${await token(request)}`};
  for (const id of createdJourneys) expect((await request.delete(`${api}/admin/journeys/${id}`,{headers})).status()).toBe(204);
  for (const id of createdPlaces) expect((await request.delete(`${api}/admin/places/${id}`,{headers})).status()).toBe(204);
});

test('journey URL reloads with ordered markers and never requests community discovery', async ({ page, context }) => {
  await page.setViewportSize({width:320,height:844});
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({latitude:10.7764,longitude:106.6993,accuracy:5});
  const community: string[] = [];
  page.on('request', req => { if (/\/osm\/nearby|wikipedia.org\/w\/api/.test(req.url())) community.push(req.url()); });
  await page.goto('/map?journey=1');
  await expect(page.locator('.journey-stop-marker')).toHaveCount(2);
  await expect(page.getByTestId('journey-stops')).toContainText('Browser Test Museum');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/acceptance-journey-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click();
  await expect(page.getByTestId('location-summary')).toContainText('Đã xác định vị trí thiết bị');
  expect(community).toEqual([]);
  await page.getByRole('button',{name:'Xem bản đồ Browser Test Museum',exact:true}).click();
  await expect(page.locator('.journey-stop-marker[data-selected="true"]')).toHaveAttribute('data-stop-id','db-1');
  await page.reload();
  await expect(page).toHaveURL(/\/map\?journey=1$/);
  await expect(page.locator('.journey-stop-marker')).toHaveCount(2);
});

test('invalid, unknown and empty journeys show an explicit state without starting narration', async ({ page, request }) => {
  const headers = {Authorization:`Bearer ${await token(request)}`};
  const empty = await request.post(`${api}/admin/journeys`,{headers,data:{name:'Empty acceptance fixture',place_ids:[]}});
  const id = (await empty.json()).id;
  createdJourneys.push(id);
  for (const [suffix,text] of [['abc','Mã hành trình không hợp lệ.'],['999999','Hành trình không tồn tại.'],[String(id),'Hành trình chưa có điểm dừng đã xuất bản.']]) {
    await page.goto(`/map?journey=${suffix}`);
    await expect(page.getByText(text,{exact:true})).toBeVisible();
    await expect(page.locator('.journey-stop-marker')).toHaveCount(0);
  }
});

test('denied GPS keeps the journey with manual audio; cancellation is not completion', async ({ page }) => {
  await speech(page);
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_success,error) => error?.({code:1,message:'Denied by acceptance fixture'} as GeolocationPositionError); });
  await page.goto('/map?journey=1');
  await page.getByRole('button',{name:'Tiếp tục hành trình',exact:true}).click();
  await expect(page.locator('.journey-stop-marker')).toHaveCount(2);
  await page.getByRole('button',{name:'Nghe Browser Test Museum',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.acceptanceSpeech.calls.length)).toBe(1);
  await expect(page.getByTestId('journey-progress')).toContainText('Đã hoàn thành: 0/2');
  await page.evaluate(() => { const u=window.acceptanceSpeech.current; u?.onerror?.call(u,{error:'synthesis-failed'} as SpeechSynthesisErrorEvent); });
  await expect(page.getByTestId('journey-playback-state')).toHaveText('Phát lỗi');
  await expect(page.getByTestId('journey-progress')).toContainText('Đã hoàn thành: 0/2');
  await page.getByRole('button',{name:'Nghe Browser Test Museum',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.acceptanceSpeech.calls.length)).toBe(2);
  await page.getByRole('button',{name:'Tạm dừng hành trình',exact:true}).click();
  await expect(page.getByTestId('journey-playback-state')).toHaveText('Đã hủy phát');
  await expect(page.getByTestId('journey-progress')).toContainText('Đã hoàn thành: 0/2');
  await page.getByRole('button',{name:'Nghe Browser Test Museum',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.acceptanceSpeech.calls.length)).toBe(3);
  await page.evaluate(() => { const u=window.acceptanceSpeech.current; u?.onend?.call(u,new Event('end') as SpeechSynthesisEvent); });
  await expect(page.getByTestId('journey-progress')).toContainText('Đã hoàn thành: 1/2');
  await page.reload();
  await expect(page.getByTestId('journey-progress')).toContainText('Đã hoàn thành: 1/2');
});

test('leaving a delayed journey cancels its request and cannot overwrite a newer journey', async ({ page, request }) => {
  const headers={Authorization:`Bearer ${await token(request)}`};
  const result=await request.post(`${api}/admin/journeys`,{headers,data:{name:'Replacement journey fixture',place_ids:[2]}});
  const id=(await result.json()).id;
  createdJourneys.push(id);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`${api}/journeys/1`,async route=>{await held;await route.fulfill({json:{id:1,name:'Late stale journey',stops:[]}}).catch(()=>{});});
  const oldRequest=page.waitForRequest(`${api}/journeys/1`);
  const failed=page.waitForEvent('requestfailed',req=>req.url()===`${api}/journeys/1`);
  await page.goto('/map?journey=1');
  await oldRequest;
  await page.getByRole('tab',{name:/Khám phá$/}).click();
  await failed;
  await page.getByText('Khám phá hành trình và điểm dừng →',{exact:true}).click();
  await page.getByRole('button',{name:'Replacement journey fixture',exact:true}).click();
  await page.getByRole('button',{name:'Bắt đầu hành trình',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/map\\?journey=${id}$`));
  release();
  const visibleJourney = page.locator('[data-testid="journey-stops"]:visible');
  await expect(visibleJourney).toHaveCount(1);
  await expect(visibleJourney).toContainText('Replacement journey fixture');
  await expect(page.getByText('Late stale journey',{exact:true})).toHaveCount(0);
  await expect(page.locator('.journey-stop-marker')).toHaveCount(1);
});

test('logout revokes stored refresh token and normal users cannot call Admin APIs', async ({ page, request }) => {
  const email = `acceptance-${Date.now()}@example.com`;
  expect((await request.post(`${api}/users`,{data:{email,password,full_name:'Acceptance User'}})).status()).toBe(201);
  await signIn(page,email);
  await expect(page).toHaveURL('http://127.0.0.1:8099/');
  await page.reload();
  const tokens = await page.evaluate(() => ({refresh:sessionStorage.getItem('mg_refresh_token_v3'),access:sessionStorage.getItem('mg_access_token_v3')}));
  expect((await request.get(`${api}/admin/places`,{headers:{Authorization:`Bearer ${tokens.access}`}})).status()).toBe(403);
  await page.goto('/profile');
  const revoked = page.waitForResponse(response => response.url() === `${api}/auth/logout` && response.status() === 204);
  await page.getByText('Đăng xuất',{exact:true}).click();
  await revoked;
  expect((await request.post(`${api}/auth/refresh`,{data:{refresh_token:tokens.refresh}})).status()).toBe(401);
  await page.reload();
  expect(await page.evaluate(() => sessionStorage.getItem('mg_refresh_token_v3'))).toBeNull();
});

test('Admin can select a labelled draft, publish it, and expose the same ordered journey', async ({ page, request }) => {
  const headers = {Authorization:`Bearer ${await token(request)}`};
  const name = `Acceptance draft ${Date.now()}`;
  const draft = await request.post(`${api}/admin/places`,{headers,data:{name,latitude:10.777,longitude:106.7}});
  const pid = (await draft.json()).id;
  createdPlaces.push(pid);
  await signIn(page,'admin@e2e.example.com');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('button',{name:'Hành trình',exact:true}).click();
  await page.getByRole('button',{name:'＋ Thêm mới',exact:true}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên hành trình',{exact:true}).fill(name);
  await dialog.getByLabel('Tìm địa điểm để thêm vào hành trình',{exact:true}).fill(name);
  await expect(dialog.getByText(`＋ ${name} (nháp)`,{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:`Thêm ${name}`,exact:true}).click();
  await dialog.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const found = await request.get(`${api}/admin/journeys?q=${encodeURIComponent(name)}`,{headers});
  const journey = (await found.json()).items[0];
  createdJourneys.push(journey.id);
  expect((await (await request.get(`${api}/journeys/${journey.id}`)).json()).place_ids).toEqual([]);
  expect((await request.put(`${api}/admin/places/${pid}`,{headers,data:{publication_status:'published'}})).status()).toBe(200);
  await page.goto(`/map?journey=${journey.id}`);
  await expect(page.locator('.journey-stop-marker')).toHaveCount(1);
  await expect(page.getByTestId('journey-stops')).toContainText(name);
});

test('upload can time out, be cancelled, and retry successfully against the backend', async ({ page, request }) => {
  const headers={Authorization:`Bearer ${await token(request)}`};
  const name=`Acceptance upload ${Date.now()}`;
  const created=await request.post(`${api}/admin/places`,{headers,data:{name,latitude:10,longitude:106}});
  const id=(await created.json()).id;
  createdPlaces.push(id);
  await signIn(page,'admin@e2e.example.com');
  await page.getByText('Địa điểm POI',{exact:true}).click();
  await page.getByPlaceholder('Tìm kiếm…').fill(name);
  await page.getByRole('button',{name:'Sửa',exact:true}).first().click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Chọn ảnh từ thiết bị',exact:true}).click();
  await (await chooser).setFiles({name:'acceptance.png',mimeType:'image/png',buffer:pixel});
  const endpoint=`${api}/admin/places/${id}/image`;
  let release: (() => void) | undefined;
  const stalled=new Promise<void>(resolve=>{release=resolve;});
  await page.route(endpoint, async route => {await stalled;await route.abort().catch(()=>{});});
  await page.clock.install();
  const uploading=page.waitForRequest(endpoint);
  await page.getByRole('button',{name:'Tải 1 ảnh lên thư viện',exact:true}).click();
  await uploading;
  await page.clock.runFor(90_001);
  await expect(page.getByText(/Máy chủ phản hồi quá thời gian chờ/)).toBeVisible();
  await page.getByRole('button',{name:'Tải 1 ảnh lên thư viện',exact:true}).click();
  await page.getByRole('button',{name:'Hủy tải ảnh',exact:true}).click();
  await expect(page.getByText('Đã hủy yêu cầu.',{exact:true})).toBeVisible();
  release?.();
  await page.unroute(endpoint);
  await page.clock.resume();
  await page.getByRole('button',{name:'Tải 1 ảnh lên thư viện',exact:true}).click();
  await expect(page.getByText('Chưa sử dụng',{exact:true}).first()).toBeVisible();
  const gallery=await request.get(`${api}/admin/places/${id}/images`,{headers});
  expect((await gallery.json()).length).toBe(1);
});
