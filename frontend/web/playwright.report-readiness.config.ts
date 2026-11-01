import { defineConfig } from "@playwright/test"
// Production panel with synthetic HTTP boundaries; not tenant/provider certification.
export default defineConfig({
  testDir: "./tests", testMatch: ["report-readiness-ui.spec.ts"], workers: 1,
  use: { baseURL: "http://127.0.0.1:3128", browserName: "chromium", headless: true },
  webServer: { command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3128",
    url: "http://127.0.0.1:3128/report-readiness", timeout: 120_000, reuseExistingServer: !process.env.CI },
})
