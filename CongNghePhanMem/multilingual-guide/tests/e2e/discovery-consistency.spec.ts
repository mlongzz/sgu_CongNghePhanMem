import {test,expect} from '@playwright/test';
import {osmPayload} from './osm-fixture';
const origin={latitude:10.776412345,longitude:106.699312345,accuracy:5};
const tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64');
test.beforeEach(async({page,context})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation(origin);
  await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:tile}));
  await page.route('https://vi.wikipedia.org/w/api.php?**',r=>r.fulfill({json:{query:{geosearch:[]}}}));
  await page.route('**/osm/nearby?**',r=>r.fulfill({json:osmPayload(r,[])}));
});
test('all five radii keep exact GPS, exclude a point 1m outside and deduplicate official IDs',async({page})=>{
  const requests:URL[]=[];
  await page.route('**/places/nearby?**',r=>{
    const u=new URL(r.request().url());requests.push(u);const radius=Number(u.searchParams.get('radius_km'));const degree=180/(Math.PI*6371);
    const item=(id:number,name:string,km:number)=>({id,name,latitude:origin.latitude+km*degree,longitude:origin.longitude,category:'Văn hóa',publication_status:'published'});
    const inside=item(50001,'Inside exact radius',radius-.001);
    return r.fulfill({json:[inside,{...inside},item(50002,'Outside exact radius',radius+.001)]});
  });
  await page.goto('/map');await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click();
  const list=page.getByTestId('nearby-place-list');
  for(const radius of [1,3,5,10,20]){
    await page.getByRole('button',{name:`Bán kính ${radius} km`,exact:true}).click();
    await expect.poll(()=>requests.at(-1)?.searchParams.get('radius_km')).toBe(String(radius));
    await expect(list.getByText('Inside exact radius',{exact:true})).toHaveCount(1);
    await expect(list.getByText('Outside exact radius',{exact:true})).toHaveCount(0);
    await expect(page.locator('.poi-marker[data-poi-id="db-50001"]')).toHaveCount(1);
  }
  for(const u of requests){expect(Number(u.searchParams.get('latitude'))).toBe(origin.latitude);expect(Number(u.searchParams.get('longitude'))).toBe(origin.longitude);}
});
test('20km empty results disclose Wikipedia 10km coverage instead of claiming a full search',async({page})=>{
  await page.route('**/places/nearby?**',r=>r.fulfill({json:[]}));
  await page.goto('/map');await page.getByRole('button',{name:'Bán kính 20 km',exact:true}).click();await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click();
  await expect(page.getByTestId('coverage-notice')).toContainText('Wikipedia: 10/20 km');
  await expect(page.getByText(/Chưa tìm thấy địa điểm trong phần dữ liệu đã có/)).toBeVisible();
  await expect(page.getByText('Chưa tìm thấy địa điểm trong bán kính đã chọn. Bạn có thể thử bán kính lớn hơn.',{exact:true})).toHaveCount(0);
});
test('official records remain visible when a new radius request and both optional sources fail',async({page})=>{
  let fail=false;
  await page.route('**/places/nearby?**',r=>fail?r.fulfill({status:503,json:{detail:'Unavailable'}}):r.fulfill({json:[{id:50003,name:'Preserved official POI',latitude:origin.latitude,longitude:origin.longitude,category:'Văn hóa',publication_status:'published'}]}));
  await page.goto('/map');await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click();
  const list=page.getByTestId('nearby-place-list');await expect(list.getByText('Preserved official POI',{exact:true})).toBeVisible();
  fail=true;await page.route('**/osm/nearby?**',r=>r.fulfill({status:503}));await page.route('https://vi.wikipedia.org/w/api.php?**',r=>r.fulfill({status:503}));
  await page.getByRole('button',{name:'Bán kính 5 km',exact:true}).click();
  await expect(page.getByText('Không thể cập nhật một số nguồn địa danh. Bạn vẫn có thể khám phá các địa điểm hiện có.',{exact:true})).toBeVisible();
  await expect(list.getByText('Preserved official POI',{exact:true})).toBeVisible();
  await expect(page.locator('.poi-marker[data-poi-id="db-50003"]')).toHaveCount(1);
});
