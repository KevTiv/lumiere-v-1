import base from "./playwright.accounting-ui.config"

export default {
  ...base,
  testMatch: ["kpi-integrity-ui.spec.ts"],
  globalSetup: undefined,
  webServer: { ...base.webServer, url: "http://127.0.0.1:3111/kpi-integrity" },
}
