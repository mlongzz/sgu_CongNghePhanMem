const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(file,dependencies={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>dependencies[name]??{},Date,Number,Set,Map});return exports;}
const nearby=load('src/services/nearby.ts');
const {mergeNearbyPlaces}=load('src/services/nearbyMerge.ts',{'./nearby':nearby});
const {partialCoverage,discoveryOutcome,freshGps}=load('src/services/discoveryStatus.ts');
const origin={latitude:0,longitude:106};
const point=(id,km,source='backend')=>({id,title:id,source,latitude:km/6371*180/Math.PI,longitude:106});
for(const radius of [1,3,5,10,20])test(`radius ${radius} km excludes the 1m-outside point and keeps exact GPS boundaries`,()=>{
  const rows=[point('inside',radius-.001),point('outside',radius+.001),point('boundary',radius)];
  assert.deepEqual(Array.from(mergeNearbyPlaces([rows],origin,radius),p=>p.id),['inside','boundary']);
});
test('source order cannot displace official identity and same-name results never supply a guessed article',()=>{
  const official={...point('db-1',.1),title:'Landmark'};
  const wiki={...point('wiki-vi-1',.10001,'wikipedia'),title:'Landmark',wikipedia:{language:'vi',pageId:7},image:'https://unverified.example/image.jpg'};
  const result=mergeNearbyPlaces([[wiki],[official]],origin,1);
  assert.equal(result.length,1);assert.equal(result[0],official);assert.equal(result[0].wikipedia,undefined);assert.equal(result[0].image,undefined);
});
test('partial coverage and failed sources are distinct from a successful empty search',()=>{
  assert.equal(partialCoverage({searchedRadiusKm:10},20),true);assert.equal(partialCoverage({searchedRadiusKm:5},5),false);assert.equal(partialCoverage({searchedRadiusKm:5,truncated:true},5),true);
  assert.equal(discoveryOutcome({count:1,loading:false,errors:true,partial:true}),'results');
  assert.equal(discoveryOutcome({count:0,loading:false,errors:true,partial:false}),'source-error');
  assert.equal(discoveryOutcome({count:0,loading:false,errors:false,partial:true}),'partial-empty');
  assert.equal(discoveryOutcome({count:0,loading:false,errors:false,partial:false}),'empty');
});
test('GPS reuse rejects stale, missing and future timestamps, including the rapid-radius path',()=>{
  const now=100_000;for(const value of [undefined,NaN,Infinity,now-60_001,now+5001])assert.equal(freshGps(value,now),false);
  for(const value of [now,now-60_000,now+5000])assert.equal(freshGps(value,now),true);
});
