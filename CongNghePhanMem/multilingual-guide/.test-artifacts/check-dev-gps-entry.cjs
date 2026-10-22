const { spawn } = require('node:child_process');
const url = 'http://localhost:8087';
let expo; let logs = '';
const complete = child => new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Browser probe exited ${code}`)));
});
(async () => {
  try {
    try { await fetch(`${url}/status`); throw new Error('Port 8087 is in use; refusing to reuse an existing process.'); }
    catch (error) { if (error.message.includes('in use')) throw error; }
    expo = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--clear', '--web', '--localhost', '--port', '8087'], {
      env: { ...process.env, BROWSER: 'none', CI: '1', EXPO_NO_TELEMETRY: '1', EXPO_OFFLINE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [expo.stdout, expo.stderr]) stream.on('data', data => { logs = (logs + data.toString()).slice(-5000); });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (/Waiting on [^\n]*8087/.test(logs)) { ready = true; break; }
      try { if ((await fetch(`${url}/status`)).ok) { ready = true; break; } } catch {}
      if (expo.exitCode !== null) throw new Error(`Expo exited ${expo.exitCode}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error('Expo did not start');
    console.log('Expo development server ready on localhost:8087; checking the browser workflow.');
    await complete(spawn(process.execPath, ['.test-artifacts/live-wikipedia-ui.cjs', ...process.argv.slice(2)], {
      env: { ...process.env, LIVE_APP_URL: `${url}/map` }, windowsHide: true, stdio: 'inherit',
    }));
  } catch (error) { console.error(error.message); console.error(logs); process.exitCode = 1; }
  finally { if (expo && expo.exitCode === null) expo.kill('SIGTERM'); }
})();
