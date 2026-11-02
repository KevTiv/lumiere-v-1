import { defineConfig } from "@playwright/test"

const chromiumPath =
  process.env.LUMIERE_CHROMIUM_PATH ??
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

// Production presentation components with synthetic ports; no live ERP effect claim.
export default defineConfig({
  testDir: "./tests",
  testMatch: "assistant-native-actions-ui.spec.ts",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3123",
    browserName: "chromium",
    headless: true,
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3123",
    url: "http://127.0.0.1:3123/assistant-actions",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
