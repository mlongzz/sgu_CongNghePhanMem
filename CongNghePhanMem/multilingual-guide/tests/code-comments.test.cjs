const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const diacritics=/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):/\.(ts|tsx)$/.test(entry.name)?[path.join(dir,entry.name)]:[]);
const offenders=(file,marker)=>fs.readFileSync(file,'utf8').split(/\r?\n/).map((line,index)=>({line:line.trim(),number:index+1}))
  .filter(({line})=>marker.test(line)&&diacritics.test(line.replace(/(["'`]).*?\1/g,'')))
  .map(({number})=>`${path.relative(root,file)}:${number}`);
test('source files contain no Vietnamese line comments',()=>{
  const found=['src','app'].flatMap(dir=>walk(path.join(root,dir))).flatMap(file=>offenders(file,/^\/\//));
  assert.deepEqual(found,[]);
});
test('start-app.cmd contains no Vietnamese REM comments',()=>{
  assert.deepEqual(offenders(path.resolve(root,'../start-app.cmd'),/^(REM|::)\s/i),[]);
});
