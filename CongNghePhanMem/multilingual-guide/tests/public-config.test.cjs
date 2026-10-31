const {test}=require('node:test');const assert=require('node:assert/strict');const {validatePublicConfig}=require('../scripts/build-public.cjs');
test('production static build refuses local/HTTP API and publicly prefixed server secrets',()=>{for(const value of ['', 'http://api.example.org','https://localhost','https://127.0.0.1','https://[::1]','https://api.local','https://user:password@api.example.org','https://api.example.org?token=value'])assert.throws(()=>validatePublicConfig({EXPO_PUBLIC_API_URL:value}));assert.throws(()=>validatePublicConfig({EXPO_PUBLIC_API_URL:'https://api.example.org',EXPO_PUBLIC_DATABASE_URL:'fixture'}));});
test('production build accepts only public configuration and trims the backend trailing slash',()=>{assert.equal(validatePublicConfig({EXPO_PUBLIC_API_URL:'https://guide-api.onrender.com/'}),'https://guide-api.onrender.com');});
test('production env files load in Expo precedence and never import server settings',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {publicBuildEnv}=require('../scripts/build-public.cjs');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'guide-build-'));
  try {
    fs.writeFileSync(path.join(directory,'.env'),'EXPO_PUBLIC_API_URL=http://localhost:8000\nDATABASE_URL=server-only');
    fs.writeFileSync(path.join(directory,'.env.production.local'),'EXPO_PUBLIC_API_URL=https://guide-api.onrender.com\n');
    assert.equal(validatePublicConfig(publicBuildEnv({},directory)),'https://guide-api.onrender.com');
    assert.equal(publicBuildEnv({},directory).DATABASE_URL,undefined);
    assert.equal(publicBuildEnv({EXPO_PUBLIC_API_URL:'https://explicit.onrender.com'},directory).EXPO_PUBLIC_API_URL,'https://explicit.onrender.com');
    for(const key of ['EXPO_PUBLIC_R2_SECRET_ACCESS_KEY','EXPO_PUBLIC_CLOUDFLARE_API_TOKEN','EXPO_PUBLIC_ACCESS_KEY_ID'])assert.throws(()=>validatePublicConfig({EXPO_PUBLIC_API_URL:'https://guide-api.onrender.com',[key]:'fixture'}));
    assert.throws(()=>validatePublicConfig({EXPO_PUBLIC_API_URL:'https://your-api.example.invalid'}));
  } finally {for(const name of ['.env','.env.production.local'])fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}
});
