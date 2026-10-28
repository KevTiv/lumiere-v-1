import { defineConfig } from '@playwright/test';

// Production subscription components with synthetic read projections; no live financial writes.
export default defineConfig({
  testDir: './tests', testMatch: ['subscriptions-ui.spec.ts'], workers: 1,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3113', browserName: 'chromium', headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3113', url: 'http://127.0.0.1:3113/subscriptions', timeout: 180_000, reuseExistingServer: !process.env.CI },
});
