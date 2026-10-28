import { defineConfig } from "@playwright/test"

// Real productivity presentation with synthetic scoped records and callbacks.
// These checks do not authenticate, mutate ERP data, or certify backend effects.
export default defineConfig({
  testDir: "./tests",
  testMatch: "productivity-workspace-ui.spec.ts",
  globalSetup: "./tests/productivity-ui-warmup.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3114",
    browserName: "chromium",
    headless: true,
    timezoneId: "Europe/Amsterdam",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3114",
    url: "http://127.0.0.1:3114/productivity",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
