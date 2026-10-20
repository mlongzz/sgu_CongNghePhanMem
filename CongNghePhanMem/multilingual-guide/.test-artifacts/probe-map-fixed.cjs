const { chromium } = require('@playwright/test');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({permissions:['geolocation'],geolocation:{latitude:10.7764,longitude:106.6993,accuracy:5}});
 const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8765/**',route=>route.fulfill({json:route.request().url().includes('/settings')?{default_language:'vi',nearby_radius_km:3}:[{id:1,name:'Expo Backend POI',latitude:10.7764,longitude:106.6993}]}));
 await page.route('**/api/interpreter',route=>route.fulfill({json:{elements:[{type:'node',id:101,lat:10.7766,lon:106.6993,tags:{name:'Expo OSM POI',tourism:'museum'}}]}}));
 await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}));
 await page.goto('http://127.0.0.1:8087/map'); await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click({timeout:120000});
 try { await page.getByTestId('nearby-place-list').getByText('Expo OSM POI',{exact:true}).waitFor({timeout:8000}); } catch { console.log((await page.locator('body').innerText()).slice(0,4000)); }
 console.log(JSON.stringify({expoWeb:true,errors,leafletMaps:await page.locator('.leaflet-container').count(),gpsMarkers:await page.locator('.user-location-marker').count(),poiMarkers:await page.locator('.poi-marker').count(),backendPoi:await page.getByTestId('nearby-place-list').getByText('Expo Backend POI',{exact:true}).isVisible(),osmPoi:await page.getByTestId('nearby-place-list').getByText('Expo OSM POI',{exact:true}).isVisible()},null,2));
 await browser.close();
})();
