const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
function load(focusEffect){
  const exports={};
  const source=ts.transpileModule(fs.readFileSync('src/hooks/useStopOnBlur.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,require:name=>name==='react'?{useCallback:fn=>fn}:{useFocusEffect:focusEffect}});
  return exports.useStopOnBlur;
}
test('speech is stopped only when the screen loses focus, not when it gains it',()=>{
  let effect;let stops=0;
  load(callback=>{effect=callback;})(()=>{stops++;});
  const cleanup=effect();
  assert.equal(stops,0);
  assert.equal(typeof cleanup,'function');
  cleanup();
  assert.equal(stops,1);
});
test('the tour player stops speech through the focus hook',()=>{
  const source=fs.readFileSync('src/components/TourPlayer.tsx','utf8');
  assert.match(source,/useStopOnBlur\(/);
});
