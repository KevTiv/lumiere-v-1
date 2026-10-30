import { defineConfig } from '@playwright/test';

/** UI-only fixture. Save/read callbacks use in-memory data, not the ERP backend. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'assistant-guides.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3114',
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev tests/navigation-guard-fixture --webpack --hostname 127.0.0.1 --port 3114',
    url: 'http://127.0.0.1:3114/guides',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
