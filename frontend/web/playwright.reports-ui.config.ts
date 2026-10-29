import { defineConfig } from "@playwright/test"
import shared from "./playwright.accounting-ui.config"

export default defineConfig({
  ...shared,
  globalSetup: undefined,
  testMatch: ["reports-workspace-ui.spec.ts"],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/reports-workspace",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
