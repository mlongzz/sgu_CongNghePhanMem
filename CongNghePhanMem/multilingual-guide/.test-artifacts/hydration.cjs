const {chromium}=require('@playwright/test');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true}); const page=await browser.newPage();
page.on('pageerror',error=>console.log('PAGEERROR',error.message)); page.on('console',msg=>{if(msg.type()==='error')console.log('CONSOLE',msg.text());});
await page.route('http://127.0.0.1:8765/**',route=>route.fulfill({json:{default_language:'vi',nearby_radius_km:3}}));
await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
await page.goto('http://127.0.0.1:8099/map'); await page.locator('.leaflet-control-zoom').waitFor();
console.log('Map visible'); await browser.close();})();
