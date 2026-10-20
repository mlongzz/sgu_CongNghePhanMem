// Run with a fresh build and isolated backend. Explicit teardown also works on Windows.
const { spawn } = require('node:child_process');
const path = require('node:path');
const windows = process.platform === 'win32';
const children = [];
const env = { ...process.env, EXPO_PUBLIC_API_URL: 'http://127.0.0.1:8765', E2E_EXTERNAL_SERVERS: '1' };
function start(command, args, options = {}) {
  const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true, ...options });
  children.push(child);
  return child;
}
function completed(child) {
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Command exited with code ${code}`))); });
}
async function ready(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Test server did not start: ${url}`);
}
async function stop() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || !child.pid) continue;
    child.kill('SIGTERM');
    child.unref();
  }
}
async function main() {
  // Refuse to reuse another developer's process on either test port.
  for (const port of [8765, 8099]) {
    try { await fetch(`http://127.0.0.1:${port}`); throw new Error(`Port ${port} is already in use. Stop the existing process before running tests.`); }
    catch (e) { if (e.message.includes('already in use')) throw e; }
  }
  const expo = path.join('node_modules', 'expo', 'bin', 'cli');
  await completed(start(process.execPath, [expo, 'export', '--platform', 'web', '--output-dir', '.e2e-web', '--clear']));
  const python = process.env.E2E_PYTHON || (windows ? '../backend/.venv/Scripts/python.exe' : '../backend/.venv/bin/python');
  start(python, ['../backend/tests/e2e_server.py']);
  start(process.execPath, ['scripts/serve-e2e.cjs']);
  await Promise.all([ready('http://127.0.0.1:8765'), ready('http://127.0.0.1:8099/login')]);
  await completed(start(process.execPath, ['node_modules/@playwright/test/cli.js', 'test']));
}
process.once('SIGINT', () => { void stop().then(() => process.exit(130)); });
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await stop();
  process.exit(process.exitCode || 0);
});
