/* global __dirname */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { validatePublicConfig, publicBuildEnv } = require('./build-public.cjs');
const { scanBundle } = require('./scan-public-bundle.cjs');
try {
  const project = path.resolve(__dirname, '..');
  const env = publicBuildEnv(process.env);
  const api = validatePublicConfig(env);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'build-public.cjs')], { cwd: project, env: { ...env, EXPO_PUBLIC_API_URL: api }, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const report = scanBundle(path.join(project, 'dist'), { ...process.env, EXPO_PUBLIC_API_URL: api });
  const directory = path.join(project, '.test-artifacts/cloudflare-build'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ ...report, recordedAt: new Date().toISOString(), status: !report.problems.length && report.apiPresent ? 'PASS' : 'FAIL' }, null, 2));
  if (report.problems.length || !report.apiPresent) throw new Error('Public bundle verification failed. See .test-artifacts/cloudflare-build/report.json; secret values are never printed.');
  console.log(`Verified ${report.files} public assets; API URL found and no server secrets detected.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
