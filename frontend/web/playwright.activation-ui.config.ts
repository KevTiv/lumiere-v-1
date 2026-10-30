import { defineConfig } from "@playwright/test"

// Synthetic reads exercise the production component, not authenticated ERP acceptance.
export default defineConfig({
  testDir: "./tests",
  testMatch: "activation-checklist-ui.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3116",
    browserName: "chromium",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3116",
    url: "http://127.0.0.1:3116/activation",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
