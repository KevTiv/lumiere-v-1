import { defineConfig } from "@playwright/test"

const port = process.env.ACCOUNTING_UI_PORT ?? "3111"
const baseURL = `http://127.0.0.1:${port}`

// This fixture renders production UI components with synthetic props. It does
// not authenticate, dispatch accounting operations, or prove backend behavior.
export default defineConfig({
  testDir: "./tests",
  testMatch: ["sidebar-workspace-ui.spec.ts", "sidebar-tables-ui.spec.ts", "accounting-guided-actions.spec.ts", "accounting-ui.spec.ts", "alpha-authoring-refinement.spec.ts", "harness-inspector-ui.spec.ts", "list-toolbar-ui.spec.ts", "style-templates-ui.spec.ts", "invoice-personalization-ui.spec.ts", "accounting-workflow-ui.spec.ts", "accounting-insights-ui.spec.ts", "module-insights-ui.spec.ts", "workspace-navigation-ui.spec.ts", "accounting-operations-ui.spec.ts", "field-helper-ui.spec.ts", "page-composition-ui.spec.ts"],
  globalSetup: "./tests/accounting-ui-warmup.ts",
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev tests/accounting-ui-fixture --webpack --hostname 127.0.0.1 --port ${port}`,
    // Warm the route containing the actual ModuleView before measuring browser interactions.
    url: `${baseURL}/style-templates`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
