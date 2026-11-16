const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const load=file=>{const m={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m});return m;};
const {refreshAndPersist}=load('src/services/sessionRestore.ts');
const makeWorld=()=>{
  const store={access:'a0',refresh:'r0'};let valid='r0';let n=0;const sent=[];
  const deps={
    refreshTokens:async r=>{sent.push(r);if(r!==valid)throw Object.assign(new Error('replay'),{status:401});n++;valid='r'+n;return {access_token:'a'+n,refresh_token:'r'+n};},
    writeSessionToken:async t=>{store.access=t;},
    writeRefreshToken:async t=>{store.refresh=t;},
  };
  return {store,sent,deps};
};
test('rotated pair is stored before any follow-up request can fail',async()=>{
  const w=makeWorld();
  const first=await refreshAndPersist(w.store.refresh,w.deps);
  assert.equal(w.store.refresh,first.refresh_token);
  assert.equal(w.store.access,first.access_token);
});
test('retry after a failed profile request sends the new refresh token, not the old one',async()=>{
  const w=makeWorld();
  const attempt=async()=>{
    const result=await refreshAndPersist(w.store.refresh,w.deps);
    if(w.sent.length===1)throw new TypeError('Failed to fetch');
    return result;
  };
  await assert.rejects(attempt,TypeError);
  const second=await attempt();
  assert.deepEqual(w.sent,['r0','r1']);
  assert.equal(second.refresh_token,'r2');
});
test('context refreshes only through the persisting helper',()=>{
  const ctx=fs.readFileSync('src/context/AppContext.tsx','utf8');
  assert.equal((ctx.match(/refreshTokens\(/g)||[]).length,0);
  assert.equal((ctx.match(/rotateTokens\(refresh\)/g)||[]).length,2);
});
