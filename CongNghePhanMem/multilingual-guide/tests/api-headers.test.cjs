const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
function load(globals){
  const exports={};
  const code=ts.transpileModule(fs.readFileSync('src/services/api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,process:{env:{EXPO_PUBLIC_API_URL:'http://test.invalid'}},AbortController,setTimeout,clearTimeout,Error,TypeError,...globals});
  return exports;
}
test('content type is only sent when there is a body',async()=>{
  const seen=[];
  const api=load({fetch:async(url,options)=>{seen.push(options.headers);return {ok:true,status:200,json:async()=>({})};}});
  await api.apiFetch('/places');
  await api.apiFetch('/favorites',{token:'t'});
  await api.apiFetch('/favorites',{token:'t',method:'POST',body:'{}'});
  assert.equal(JSON.stringify(seen[0]),'{}');
  assert.equal(JSON.stringify(seen[1]),'{"Authorization":"Bearer t"}');
  assert.equal(seen[2]['Content-Type'],'application/json');
  assert.equal(seen[2].Authorization,'Bearer t');
});
