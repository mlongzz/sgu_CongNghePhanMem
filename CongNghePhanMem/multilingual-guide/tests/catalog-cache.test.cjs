const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const loaded={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/catalogCache.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded});
const {isCatalogFresh,CATALOG_MAX_AGE_MS}=loaded;
test('catalog freshness window is five minutes',()=>{
  assert.equal(CATALOG_MAX_AGE_MS,300000);
  assert.equal(isCatalogFresh(null,1000,CATALOG_MAX_AGE_MS),false);
  assert.equal(isCatalogFresh(1000,1000+299999,CATALOG_MAX_AGE_MS),true);
  assert.equal(isCatalogFresh(1000,1000+300000,CATALOG_MAX_AGE_MS),false);
  assert.equal(isCatalogFresh(5000,1000,CATALOG_MAX_AGE_MS),false);
});
test('refreshing the catalog keeps the previous list until the new one arrives',()=>{
  const source=fs.readFileSync('src/context/AppContext.tsx','utf8');
  const body=source.slice(source.indexOf('const refreshCatalog'),source.indexOf('const updateProfile'));
  assert.ok(!body.includes('setPlaces([])'));
  assert.ok(body.includes('isCatalogFresh('));
  assert.match(fs.readFileSync('app/(tabs)/index.tsx','utf8'),/refreshCatalog\(\{ maxAgeMs: CATALOG_MAX_AGE_MS \}\)/);
});
