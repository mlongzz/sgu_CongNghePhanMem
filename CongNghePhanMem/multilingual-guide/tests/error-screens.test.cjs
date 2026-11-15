const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');
const {renderNative}=require('./helpers/native-render.cjs');
const mark=text=>`«${text}»`;
test('error screen renders translated title, message and action for both kinds',()=>{
  for(const [kind,parts] of [['error',['Đã xảy ra lỗi','Thử lại']],['notFound',['Không tìm thấy trang','Về Trang chủ']]]){
    const result=renderNative('src/components/ErrorScreen.tsx',{props:{kind,t:mark,onAction:()=>{}}});
    assert.deepEqual(result.raw,[]);
    for(const part of parts)assert.ok(result.markup.includes(mark(part)),part);
  }
});
test('root layout exports ErrorBoundary and a not-found route exists',()=>{
  assert.match(fs.readFileSync('app/_layout.tsx','utf8'),/export function ErrorBoundary\(/);
  assert.match(fs.readFileSync('app/+not-found.tsx','utf8'),/export default function NotFound/);
});
test('every error screen string has English, French and Japanese copy',()=>{
  const rows=fs.readFileSync('src/services/i18n.ts','utf8').split(/\r?\n/);
  const screen=fs.readFileSync('src/components/ErrorScreen.tsx','utf8');
  const keys=[...screen.matchAll(/(?:title|message|action): '([^']+)'/g)].map(match=>match[1]);
  assert.equal(keys.length,6);
  for(const key of keys){
    const row=rows.find(line=>line.trim().startsWith(`'${key}': [`));
    assert.ok(row,key);
    assert.equal(row.slice(row.indexOf('[')).split("', '").length,3,key);
  }
});
