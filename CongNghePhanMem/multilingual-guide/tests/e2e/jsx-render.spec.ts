import { test, expect, type Page } from '@playwright/test';
const api='http://127.0.0.1:8765';
async function login(page:Page){
  await page.goto('/login');await page.getByLabel('Địa chỉ email',{exact:true}).fill('admin@e2e.example.com');await page.getByLabel('Mật khẩu',{exact:true}).fill('TestPassword123!');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
}
test('Admin empty image editor, zero presence ID, missing import sources and no journey stops render safely',async({page})=>{
  const warnings:string[]=[],errors:string[]=[];
  page.on('console',message=>{if(/Unexpected text node|Text strings must be rendered/.test(message.text()))warnings.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
  await login(page);
  await page.route(api+'/admin/images/places?**',route=>route.fulfill({json:{items:[{id:99991,name:'JSX empty image fixture',image_url:null,images:{}}],total:1,page:1,pages:1}}));
  await page.route(api+'/admin/places/99991/images',route=>route.fulfill({json:[]}));
  await page.getByRole('button',{name:'Thư viện ảnh',exact:true}).click();await page.getByRole('button',{name:'Quản lý ảnh JSX empty image fixture'}).click();
  await expect(page.getByRole('button',{name:'Hoàn tác chỉnh sửa ảnh chưa lưu'})).toHaveCount(0);
  await page.getByLabel('URL ảnh nhập vào thư viện').fill('https://images.example.org/fixture.jpg');await expect(page.getByRole('button',{name:'Hoàn tác chỉnh sửa ảnh chưa lưu'})).toBeVisible();
  await page.getByRole('button',{name:'Hoàn tác chỉnh sửa ảnh chưa lưu'}).click();await expect(page.getByRole('button',{name:'Hoàn tác chỉnh sửa ảnh chưa lưu'})).toHaveCount(0);
  await page.getByRole('button',{name:'Đóng thư viện ảnh'}).click();await expect(page.getByRole('button',{name:'Đóng thư viện ảnh'})).toBeHidden();
  await page.route(api+'/admin/presence?**',route=>route.fulfill({json:{items:[{id:0,email:'zero-id@example.test',full_name:'Zero ID fixture',online:false,active_sessions:0,last_seen_at:null,online_seconds:0,offline_seconds_estimated:null}],total:1,page:1,pages:1}}));
  await page.getByRole('button',{name:'Online & hoạt động',exact:true}).click();await page.getByRole('button',{name:'Phiên hoạt động zero-id@example.test'}).click();
  await expect(page.getByRole('button',{name:'Đóng chi tiết phiên'})).toHaveCount(0);
  expect(await page.getByTestId('presence-dashboard').evaluate(element=>Array.from(element.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim()==='0').length)).toBe(0);
  await page.route(api+'/admin/imports/osm/preview',route=>route.fulfill({json:{preview_token:'explicit-jsx-fixture-not-for-import',rows:[{name:'Missing source fixture',status:'create'},{name:'Empty source fixture',source_id:'',source_url:'',sources:[],status:'create'}],counts:{create:2}}}));
  await page.getByRole('button',{name:'Nhập địa danh',exact:true}).click();await page.getByLabel('Dữ liệu OSM (JSON)').fill('{"places":[]}');await page.getByRole('button',{name:'Xem trước OSM',exact:true}).click();
  await expect(page.getByText('Missing source fixture',{exact:true})).toBeVisible();await expect(page.getByText('Empty source fixture',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/^Nguồn (Missing|Empty) source fixture$/})).toHaveCount(0);
  await page.getByRole('button',{name:'Hành trình',exact:true}).click();await page.getByRole('button',{name:'＋ Thêm mới',exact:true}).click();
  await expect(page.getByText('Các điểm dừng theo thứ tự',{exact:false})).toContainText('(0/200)');
  await expect(page.getByRole('button',{name:'Bỏ điểm dừng',exact:true})).toHaveCount(0);
  expect(warnings).toEqual([]);expect(errors).toEqual([]);
});

test('Anonymous Admin/Login/Profile navigation has no raw text nodes or page errors',async({page})=>{
  const warnings:string[]=[],errors:string[]=[];
  page.on('console',message=>{if(/Unexpected text node|Text strings must be rendered/.test(message.text()))warnings.push(message.text());});page.on('pageerror',error=>errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
  await page.goto('/admin');await expect(page).toHaveURL(/\/login$/);await expect(page.getByLabel('Địa chỉ email',{exact:true})).toBeVisible();
  await page.goto('/profile');await expect(page.getByText('Nhà khám phá',{exact:true})).toBeVisible();
  expect(warnings).toEqual([]);expect(errors).toEqual([]);
});
