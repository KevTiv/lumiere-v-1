import { defineConfig } from "@playwright/test";

// Production presentation with synthetic props; this suite is not live ERP acceptance.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["product-fleet-warehouse-ui.spec.ts"],
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3121",
    browserName: "chromium",
    headless: true,
    timezoneId: "UTC",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    env: { TZ: "UTC" },
    command:
      "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3121",
    url: "http://127.0.0.1:3121/product-fleet",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
