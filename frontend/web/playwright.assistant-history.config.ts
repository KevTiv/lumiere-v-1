import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "assistant-history-load.spec.ts",
  outputDir: "test-results/assistant-history",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    ...devices["Pixel 5"],
    viewport: { width: 320, height: 740 },
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  },
})
