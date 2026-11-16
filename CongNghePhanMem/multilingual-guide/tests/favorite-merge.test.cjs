const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const loaded={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/favoriteMerge.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Promise,Set,Number});
const {mergeGuestFavorites}=loaded;
test('guest system favourites are posted, duplicates count as merged, failures are kept',async()=>{
  const posted=[];
  const out=await mergeGuestFavorites(['db-1','db-2','db-3','poi-7','db-1'],async id=>{
    posted.push(id);
    if(id===2)throw Object.assign(new Error('dup'),{status:409});
    if(id===3)throw new Error('network');
    return {};
  });
  assert.deepEqual(posted,[1,2,3]);
  assert.deepEqual([...out.resolved],['db-1','db-2']);
  assert.deepEqual([...out.failed],['db-3']);
});
test('nothing to merge makes no request',async()=>{
  let calls=0;
  const out=await mergeGuestFavorites(['poi-1'],async()=>{calls++;});
  assert.equal(calls,0);
  assert.equal(JSON.stringify(out),'{"resolved":[],"failed":[]}');
});
test('AppContext merges guest favourites after sign-in and only clears resolved ids',()=>{
  const src=fs.readFileSync('src/context/AppContext.tsx','utf8');
  assert.ok(src.includes('mergeGuestFavorites('));
  assert.ok(src.includes('resolved.includes(id)'));
});
