/* global __dirname */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { publicBuildEnv } = require('./public-build-env.cjs');
function validatePublicConfig(env) {
  let url;
  try { url = new URL(env.EXPO_PUBLIC_API_URL); } catch { throw new Error('Set EXPO_PUBLIC_API_URL to the public HTTPS backend before building.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || host === 'localhost' || host.endsWith('.local') || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.test')) throw new Error('Production API URL must use a public HTTPS hostname without credentials.');
  if (host.endsWith('.invalid') || /(?:^|\.)example\.(?:com|org|net)$/.test(host) || host.endsWith('.example') || host.endsWith('.internal') || host.endsWith('.localhost')) throw new Error('Replace the example API hostname with your actual public backend.');
  for (const key of Object.keys(env)) if (/^EXPO_PUBLIC_.*(?:SECRET|DATABASE|PASSWORD|PRIVATE_KEY|ACCESS_KEY|API_TOKEN|CLOUDFLARE|R2_)/i.test(key)) throw new Error('A server-only setting has an EXPO_PUBLIC_ prefix. Remove it before building.');
  return url.href.replace(/\/$/, '');
}
module.exports = { validatePublicConfig, publicBuildEnv };
if (require.main === module) {
  try {
    const env = publicBuildEnv(process.env);
    const api = validatePublicConfig(env);
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist', '--clear'], { cwd: path.resolve(__dirname, '..'), env: { ...env, EXPO_PUBLIC_API_URL: api, EXPO_PUBLIC_ENABLE_DIAGNOSTICS: '0' }, stdio: 'inherit', windowsHide: true });
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
