import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests", testMatch: ["platform-ai-profile-ui.spec.ts"], workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3132", browserName: "chromium", headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3132",
    url: "http://127.0.0.1:3132/platform-ai-profile", timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
