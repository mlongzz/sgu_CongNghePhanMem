// Recheck tests against the unchanged application export after fixing only a test fixture.
const fs = require('node:fs');
const source = fs.readFileSync('scripts/run-e2e.cjs', 'utf8');
const build = "  await completed(start(process.execPath, [expo, 'export', '--platform', 'web', '--output-dir', '.e2e-web', '--clear']));";
if (!source.includes(build) || !fs.existsSync('.e2e-web/map.html')) throw new Error('Expected existing application export/runner not found.');
new Function('require', source.replace(build, "  console.log('Reusing unchanged Web export; only the GPS test fixture changed.');"))(require);
