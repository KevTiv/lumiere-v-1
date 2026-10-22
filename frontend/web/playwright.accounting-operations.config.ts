import { defineConfig } from "@playwright/test"
import base from "./playwright.accounting-ui.config"

const webServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer
if (!webServer) throw new Error("The accounting fixture web server is required")

// Compile only this production-component fixture before its interaction budgets begin.
export default defineConfig({
  ...base,
  globalSetup: undefined,
  testMatch: ["accounting-operations-ui.spec.ts"],
  webServer: {
    ...webServer,
    url: "http://127.0.0.1:3111/operations",
    timeout: 600_000,
  },
})
