/* global __dirname */
// Local workerd + self-signed HTTPS. No account, login, tunnel or remote binding.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const {chromium,request,expect}=require('@playwright/test');
const {scanBundle}=require('./scan-public-bundle.cjs');
const project=path.resolve(__dirname,'..'),artifacts=path.join(project,'.test-artifacts/worker-local');
const base='https://127.0.0.1:8788';
async function main(){
  fs.mkdirSync(artifacts,{recursive:true});
  const client=await request.newContext({ignoreHTTPSErrors:true});
  let busy=false;try{await client.get(base,{timeout:800});busy=true;}catch{/* unused port */}
  if(busy)throw new Error('Local test port 8788 already in use');
  const log=fs.openSync(path.join(artifacts,'wrangler.log'),'w');
  const worker=spawn(process.execPath,[path.join(project,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--ip','127.0.0.1','--port','8788','--inspector-port','9235','--local-protocol','https','--show-interactive-dev-session=false'],{cwd:project,env:{...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_SEND_METRICS:'false'},stdio:['ignore',log,log],windowsHide:true});
  let browser;
  try{
    await expect.poll(async()=>{try{return(await client.get(base,{timeout:1000})).status();}catch{return 0;}},{timeout:30_000}).toBe(200);
    const routes=[];
    for(const url of ['/','/map','/map/','/login','/register','/admin','/journeys','/saved','/profile','/history','/account','/place/db-1','/place/wikipedia-vi-40515']){
      const response=await client.get(base+url);
      expect(response.status(),url).toBe(200);expect(response.headers()['content-type']).toContain('text/html');
      routes.push({url,status:response.status()});
    }
    expect((await client.get(base+'/_expo/static/js/nonexistent.js')).status()).toBe(404);
    expect((await client.post(base+'/map')).status()).toBe(405);
    const api='http://127.0.0.1:8765';
    const scan=scanBundle(path.join(project,'dist'),{...process.env,EXPO_PUBLIC_API_URL:api});
    expect(scan.problems).toEqual([]);expect(scan.apiPresent).toBe(true);
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({ignoreHTTPSErrors:true,permissions:['geolocation'],geolocation:{latitude:10.7764,longitude:106.6993,accuracy:8}});
    const page=await context.newPage(),errors=[];let queries=0;
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
    await page.route(api+'/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/places/nearby')queries++;return route.fulfill({status:url.pathname==='/osm/nearby'?504:200,headers:{'Access-Control-Allow-Origin':base},json:url.pathname==='/settings'?{}:url.pathname.endsWith('/reviews/summary')?{average_rating:null,review_count:0}:[]});});
    await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
    await page.route('https://vi.wikipedia.org/w/api.php?**',route=>route.fulfill({json:{query:{geosearch:[{pageid:40515,ns:0,title:'HTTPS GPS fixture',lat:10.7764,lon:106.6993}]}}}));
    await page.goto(base+'/map');
    expect(await page.evaluate(()=>isSecureContext)).toBe(true);
    await page.getByRole('button',{name:'Dùng GPS và tìm địa danh',exact:true}).click();
    await expect(page.getByTestId('nearby-place-list').getByText('HTTPS GPS fixture',{exact:true})).toBeVisible();
    expect(queries).toBeGreaterThan(0);expect(errors).toEqual([]);
    await expect(page.getByRole('button',{name:'Developer Diagnostics',exact:true})).toHaveCount(0);
    await page.screenshot({path:path.join(artifacts,'https-map.png')});
    await page.route(api+'/places/1',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':base},json:{id:1,name:'Worker direct-route fixture',description:'Verified browser fixture',latitude:10.7764,longitude:106.6993,publication_status:'published'}}));
    await page.goto(base+'/place/db-1');
    await expect(page.getByText('Worker direct-route fixture',{exact:true}).first()).toBeVisible();
    await expect(page).toHaveURL(base+'/place/db-1');
    await page.reload();await expect(page.getByText('Worker direct-route fixture',{exact:true}).first()).toBeVisible();
    expect(errors).toEqual([]);
    fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({status:'PASS',mode:'local self-signed HTTPS; browser geolocation/provider fixtures',publicDeploymentTested:false,routes,missingAsset:404,method:405,secureContext:true,gpsFixture:true,dynamicRouteHydrationAndReload:true,pageErrors:errors,scan},null,2));
    console.log(`PASS: ${routes.length} direct routes, missing JS 404, HTTPS GPS fixture and secret scan (${scan.files} text assets).`);
  }finally{
    if(browser)await browser.close();await client.dispose();
    worker.kill('SIGTERM');await Promise.race([new Promise(resolve=>worker.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);worker.unref();fs.closeSync(log);
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
