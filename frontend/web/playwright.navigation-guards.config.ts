import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'navigation-guards.spec.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3109', browserName: 'chromium', headless: true },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev tests/navigation-guard-fixture --webpack --hostname 127.0.0.1 --port 3109',
    url: 'http://127.0.0.1:3109',
    timeout: 120_000,
  },
});
