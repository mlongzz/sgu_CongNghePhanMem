const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');const vm=require('node:vm');
const load=file=>{const m={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:m});return m;};
const {screenCopy}=load('src/services/screenI18n.ts');
test('every screen string has English, French and Japanese copy',()=>{
  for(const [key,value] of Object.entries(screenCopy)){
    assert.equal(value.length,3,key);
    value.forEach(v=>assert.ok(typeof v==='string'&&v.trim().length>0,key));
  }
});
test('formerly hard-coded visitor strings are registered',()=>{
  for(const key of ['Địa điểm đã được xóa','Trang','Đang hiển thị thông tin đã lưu.','Không tải được OpenStreetMap.','Không tải được Wikipedia.','Lỗi kết nối không xác định','Không tải được tên địa điểm'])
    assert.ok(screenCopy[key],key);
});
test('visitor screens route dynamic messages through t()',()=>{
  const read=f=>fs.readFileSync(f,'utf8');
  assert.match(read('app/(tabs)/index.tsx'),/\{t\(placesError\)\}/);
  assert.match(read('app/(tabs)/index.tsx'),/\{t\(placesWarning\)\}/);
  assert.match(read('app/place/[id].tsx'),/t\('Đang hiển thị thông tin đã lưu\.'\)/);
  assert.match(read('app/(tabs)/profile.tsx'),/\{t\(error\)\}/);
  assert.match(read('app/history.tsx'),/t\('Trang'\)/);
});
