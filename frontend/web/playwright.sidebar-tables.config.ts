import { defineConfig } from "@playwright/test"
import accountingUi from "./playwright.accounting-ui.config"

export default defineConfig({
  ...accountingUi,
  testMatch: ["sidebar-tables-ui.spec.ts", "sidebar-workspace-ui.spec.ts"],
  globalSetup: undefined,
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/sidebar-preview",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
