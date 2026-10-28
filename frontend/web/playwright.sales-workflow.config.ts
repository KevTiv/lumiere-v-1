import { defineConfig } from '@playwright/test';

// Synthetic props drive actual sales components; this does not prove persisted ERP effects.
export default defineConfig({
  testDir: './tests', testMatch: 'sales-workflow-ui.spec.ts', workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3112', browserName: 'chromium', headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3112',
    url: 'http://127.0.0.1:3112/sales-workflow', timeout: 120_000, reuseExistingServer: !process.env.CI,
  },
});
