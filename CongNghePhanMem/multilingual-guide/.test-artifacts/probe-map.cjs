const { chromium } = require('@playwright/test');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const context = await browser.newContext({permissions:['geolocation'],geolocation:{latitude:10.7764,longitude:106.6993,accuracy:5}});
 const page = await context.newPage(); const errors=[]; const modules=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(/MapScreen|nearby/.test(response.url()))modules.push(response.url());});
 await page.route('**/api/interpreter',route=>route.fulfill({json:{elements:[{type:'node',id:101,lat:10.7766,lon:106.6993,tags:{name:'Baseline OSM Museum',tourism:'museum'}}]}}));
 await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}));
 await page.goto('http://127.0.0.1:8087/map');
 await page.getByText('Dùng GPS và tìm địa danh',{exact:true}).click({timeout:120000});
 try {await page.getByText('Baseline OSM Museum',{exact:true}).waitFor({timeout:20000});}catch{}
 console.log(JSON.stringify({errors,modules,osmVisible:await page.getByText('Baseline OSM Museum',{exact:true}).isVisible(),markerCount:await page.locator('.leaflet-overlay-pane path').count()},null,2));
 await browser.close();
})();
