/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const serverKeys = ['SECRET_KEY', 'DATABASE_URL', 'CLOUDINARY_API_SECRET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_API_TOKEN'];
function knownServerValues(env, backendEnv = '') {
  const values = { ...env };
  for (const line of backendEnv.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && serverKeys.includes(match[1]) && !values[match[1]]) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return serverKeys.filter(key => typeof values[key] === 'string' && values[key].length >= 8).map(key => ({ key, value: values[key] }));
}
function scanText(text, secrets) {
  const found = secrets.filter(item => text.includes(item.value)).map(item => item.key);
  if (/postgres(?:ql)?:\/\/[^\s"'<>]+/i.test(text)) found.push('DATABASE_CONNECTION_STRING');
  if (/process\.env\.(?:SECRET_KEY|DATABASE_URL|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|CLOUDFLARE_API_TOKEN|CLOUDINARY_API_SECRET)/.test(text)) found.push('SERVER_ENV_REFERENCE');
  return [...new Set(found)];
}
function scanBundle(directory, env = process.env) {
  const backendPath = path.resolve(__dirname, '../../backend/.env');
  const secrets = knownServerValues(env, fs.existsSync(backendPath) ? fs.readFileSync(backendPath, 'utf8') : '');
  const problems = []; let files = 0, apiPresent = false;
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (/\.(js|mjs|json|html|css|map)$/.test(entry.name)) {
        files++; const text = fs.readFileSync(filename, 'utf8');
        if (env.EXPO_PUBLIC_API_URL && text.includes(env.EXPO_PUBLIC_API_URL.replace(/\/$/, ''))) apiPresent = true;
        const kinds = scanText(text, secrets);
        if (kinds.length) problems.push({ file: path.relative(directory, filename), kinds });
      }
    }
  }
  walk(directory);
  return { files, apiPresent, problems };
}
module.exports = { scanText, knownServerValues, scanBundle };
