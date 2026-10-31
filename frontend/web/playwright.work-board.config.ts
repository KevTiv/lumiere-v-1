import { defineConfig } from "@playwright/test"

/** Real work board UI and transport, synthetic HTTP/session boundary; no live ERP claims. */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["work-board-ui.spec.ts", "select-controls-ui.spec.ts", "import-review-ui.spec.ts", "import-source-detail-ui.spec.ts", "prepared-product-import-ui.spec.ts", "document-upload-receipts-ui.spec.ts", "company-setup-ui.spec.ts"],
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:3113",
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3113",
    url: "http://127.0.0.1:3113/work-board",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
