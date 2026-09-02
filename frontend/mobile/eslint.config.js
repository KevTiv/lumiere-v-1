// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lumiere/stdb',
                '@lumiere/stdb/*',
                'spacetimedb',
                'spacetimedb/*',
              ],
              message:
                'End-user mobile clients must use @lumiere/api-client so tenant and field authorization stays server-owned.',
            },
          ],
        },
      ],
    },
  },
]);
