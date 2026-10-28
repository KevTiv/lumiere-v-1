import { defineConfig } from "@playwright/test"

// This fixture renders production UI components with synthetic props. It does
// not authenticate, dispatch accounting operations, or prove backend behavior.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["accounting-ui.spec.ts", "alpha-authoring-refinement.spec.ts", "style-templates-ui.spec.ts", "invoice-personalization-ui.spec.ts", "accounting-workflow-ui.spec.ts", "accounting-insights-ui.spec.ts", "module-insights-ui.spec.ts", "workspace-navigation-ui.spec.ts", "accounting-operations-ui.spec.ts", "field-helper-ui.spec.ts"],
  globalSetup: "./tests/accounting-ui-warmup.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3111",
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port 3111",
    // Warm the route containing the actual ModuleView before measuring browser interactions.
    url: "http://127.0.0.1:3111/style-templates",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
