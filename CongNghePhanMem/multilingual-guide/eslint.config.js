const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'build-admin/**', 'build-android/**', 'build-ios/**', '.e2e-web/**', '.test-artifacts/**', 'test-results/**', 'playwright-report/**', '.expo/**'] },
]);
