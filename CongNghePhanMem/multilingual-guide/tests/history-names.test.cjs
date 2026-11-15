const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const loaded={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/history.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,Promise,Map,Set});
const {resolveVisitNames}=loaded;
const visit=(id,place_id,extra={})=>({id,place_id,visited_at:'2026-01-01T00:00:00',...extra});
test('place_name from the API is used without any lookup',async()=>{
  let calls=0;
  const rows=await resolveVisitNames([visit(1,5,{place_name:'Dinh Độc Lập'}),visit(2,6,{place_name:null})],async()=>{calls++;return 'x';});
  assert.equal(calls,0);
  assert.deepEqual(rows.map(r=>[r.name,r.state]),[['Dinh Độc Lập','ok'],['','deleted']]);
});
test('missing place_name falls back to lookups and one failure keeps the other rows',async()=>{
  const seen=[];
  const rows=await resolveVisitNames([visit(1,5),visit(2,6),visit(3,7),visit(4,5)],async id=>{
    seen.push(id);
    if(id===6)throw Object.assign(new Error('nf'),{status:404});
    if(id===7)throw new Error('network');
    return 'Chợ Bến Thành';
  });
  assert.deepEqual(seen,[5,6,7]);
  assert.deepEqual(rows.map(r=>r.state),['ok','deleted','unavailable','ok']);
  assert.equal(rows[3].name,'Chợ Bến Thành');
});
