/* global __dirname */
const path = require('node:path');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
function publicBuildEnv(env, project = path.resolve(__dirname, '..')) {
  const loaded = {};
  for (const name of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    const file = path.join(project, name);
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) if (key.startsWith('EXPO_PUBLIC_')) loaded[key] = value;
  }
  return { ...loaded, ...env };
}
module.exports = { publicBuildEnv };
