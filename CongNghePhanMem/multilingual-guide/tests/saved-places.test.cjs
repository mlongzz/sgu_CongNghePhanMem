const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const loaded={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/savedPlaces.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Promise,Map,Number});
const {resolveSavedPlaces}=loaded;
const place=id=>({id,name:id});
test('places already in context are not fetched and one failure keeps the rest',async()=>{
  const fetched=[];
  const cache=new Map();
  const out=await resolveSavedPlaces({
    ids:['db-1','db-2','db-3','db-4','poi-9'],
    known:id=>id==='db-1'?place('db-1'):undefined,
    cache,
    fetchPlace:async n=>{fetched.push(n);if(n===3)throw new Error('network');if(n===4)throw Object.assign(new Error('nf'),{status:404});return place('db-'+n);},
  });
  assert.deepEqual(fetched,[2,3,4]);
  assert.deepEqual(out.places.map(p=>p.id),['db-1','db-2']);
  assert.equal(out.failed,1);
  assert.equal(cache.has('db-3'),false);
  assert.equal(cache.get('db-4'),null);
});
test('a second pass reuses the cache and retries only failures',async()=>{
  const cache=new Map([['db-2',place('db-2')],['db-4',null]]);
  const fetched=[];
  const out=await resolveSavedPlaces({ids:['db-2','db-3','db-4'],known:()=>undefined,cache,fetchPlace:async n=>{fetched.push(n);return place('db-'+n);}});
  assert.deepEqual(fetched,[3]);
  assert.deepEqual(out.places.map(p=>p.id),['db-2','db-3']);
  assert.equal(out.failed,0);
});
test('saved screen depends on a string key and refreshes once',()=>{
  const src=fs.readFileSync('app/(tabs)/saved.tsx','utf8');
  assert.ok(src.includes('resolveSavedPlaces('));
  assert.ok(!src.includes('Promise.all('));
  assert.match(src,/\[key, retry\]/);
});
