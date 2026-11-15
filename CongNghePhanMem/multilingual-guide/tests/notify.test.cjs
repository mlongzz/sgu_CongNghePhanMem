const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
function load(os,alertCalls,windowCalls){
  const exports={};
  const code=ts.transpileModule(fs.readFileSync('src/services/notify.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const rn={Alert:{alert:(...a)=>alertCalls.push(a)},Platform:{OS:os}};
  vm.runInNewContext(code,{exports,require:()=>rn,window:{alert:m=>windowCalls.push(m)}});
  return exports;
}
test('web uses window.alert and native uses Alert.alert',()=>{
  const nativeCalls=[],webCalls=[];
  load('web',nativeCalls,webCalls).notify('Title','Body');
  assert.equal(nativeCalls.length,0);
  assert.equal(webCalls[0],'Title\nBody');
  const nativeAlert=[],nativeWindow=[];
  load('android',nativeAlert,nativeWindow).notify('Title','Body');
  assert.equal(nativeWindow.length,0);
  assert.equal(nativeAlert[0].join('|'),'Title|Body');
});
test('sign-out notice goes through notify',()=>{
  const src=fs.readFileSync('app/(tabs)/profile.tsx','utf8');
  assert.ok(src.includes("notify(t('Đã đăng xuất')"));
  assert.ok(!src.includes('Alert.alert('));
});
