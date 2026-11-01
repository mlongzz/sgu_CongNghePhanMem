const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const output = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/presence.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output.exports,require:()=>({}),performance:{now:()=>0}});
const {PresenceClient}=output.exports;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(request) {
  let now=0;const calls=[];
  const client=new PresenceClient(async (url,options)=>{const call={url,...options,data:JSON.parse(options.body)};calls.push(call);return request?request(call):{id:'session-1'};},()=>now);
  return {client,calls,advance(seconds){for(let i=0;i<seconds;i++){now+=1000;client.tick();}},jump(seconds){now+=seconds*1000;client.tick();},async login(){client.setAccount(1,'jwt-one');client.setEnabled(true);client.setVisible(true);await flush();}};
}
test('presence requires login, policy enabled and visible app; no private events sent',async()=>{
  const f=fixture();f.client.setVisible(true);f.advance(60);await flush();assert.equal(f.calls.length,0);
  await f.login();assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/presence/start');
  assert.match(f.calls[0].data.client_id,/^[0-9a-f-]{36}$/);assert.deepEqual(Object.keys(f.calls[0].data).sort(),['client_id','device']);
  f.client.setVisible(false);f.advance(120);await flush();assert.equal(f.calls.length,1);
});
test('30-second heartbeat distinguishes foreground and interaction, bounds suspended timers',async()=>{
  const f=fixture();await f.login();f.advance(30);await flush();
  assert.equal(f.calls[1].data.foreground_seconds,30);assert.equal(f.calls[1].data.interaction_seconds,0);
  f.client.interact();f.advance(30);await flush();assert.equal(f.calls[2].data.interaction_seconds,30);
  f.jump(300);await flush();assert.equal(f.calls[3].data.foreground_seconds,5);assert.equal(f.calls[3].data.interaction_seconds,5);
});
test('token refresh preserves the session; logout ends it with owner token and keepalive',async()=>{
  const f=fixture();await f.login();const id=f.calls[0].data.client_id;
  f.client.setAccount(1,'jwt-refreshed');f.advance(30);await flush();
  assert.equal(f.calls[1].token,'jwt-refreshed');assert.equal(f.calls[1].data.session_id,'session-1');
  f.client.setAccount(null,null);await flush();assert.equal(f.calls[2].url,'/presence/end');assert.equal(f.calls[2].token,'jwt-refreshed');assert.equal(f.calls[2].data.reason,'logout');assert.equal(f.calls[2].keepalive,true);
  f.advance(120);await flush();assert.equal(f.calls.length,3);assert.ok(id);
});
test('expired session rotates nonce; offline failures retry with a bounded delay',async()=>{
  let fail=true;const f=fixture(call=>{if(call.url==='/presence/heartbeat'&&fail){fail=false;throw Object.assign(new Error('expired'),{status:409});}return {id:'next'};});
  await f.login();const first=f.calls[0].data.client_id;f.advance(30);await flush();f.advance(1);await flush();
  assert.equal(f.calls[2].url,'/presence/start');assert.notEqual(f.calls[2].data.client_id,first);
  const offline=fixture(()=>{throw new Error('offline');});await offline.login();offline.advance(29);await flush();assert.equal(offline.calls.length,1);offline.advance(1);await flush();assert.equal(offline.calls.length,2);
});
test('late start after logout is closed without attributing it to the next user',async()=>{
  let finish;const f=fixture(call=>call.url==='/presence/start'?new Promise(resolve=>{finish=resolve;}):{});
  f.client.setAccount(1,'old-jwt');f.client.setEnabled(true);f.client.setVisible(true);
  f.client.setAccount(2,'new-jwt');finish({id:'old-session'});await flush();
  assert.equal(f.calls[1].url,'/presence/end');assert.equal(f.calls[1].token,'old-jwt');assert.equal(f.calls[1].data.session_id,'old-session');
});
test('separate tabs have separate nonces and opt-out stops collection',async()=>{
  const a=fixture(),b=fixture();await a.login();await b.login();assert.notEqual(a.calls[0].data.client_id,b.calls[0].data.client_id);
  a.client.setEnabled(false);await flush();a.advance(300);await flush();assert.equal(a.calls.length,2);assert.equal(a.calls[1].url,'/presence/end');
});
