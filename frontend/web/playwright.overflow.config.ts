import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "ui-overflow.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3110",
    browserName: "chromium",
    headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next dev tests/navigation-guard-fixture --webpack --hostname 127.0.0.1 --port 3110",
    url: "http://127.0.0.1:3110/overflow",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { NEXT_PUBLIC_API_GATEWAY_URL: "", NEXT_TELEMETRY_DISABLED: "1" },
  },
})
