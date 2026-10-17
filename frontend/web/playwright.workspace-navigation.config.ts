import { defineConfig } from "@playwright/test"
import accountingUi from "./playwright.accounting-ui.config"

/** Focused navigation/template checks without warming unrelated workflows. */
export default defineConfig({
  ...accountingUi,
  testMatch: ["workspace-navigation-ui.spec.ts", "style-templates-ui.spec.ts"],
  globalSetup: "./tests/workspace-navigation-warmup.ts",
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/style-templates",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
