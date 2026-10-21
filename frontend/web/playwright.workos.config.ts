import { defineConfig } from "@playwright/test"

/**
 * WorkOS-mode acceptance (COV-23). Runs against the stack started by
 * scripts/workos-docker-stack.sh, served over https by scripts/local-https-proxy.mjs.
 * Sessions are captured once by the operator (never by the test) into .tmp/workos/.
 */
export default defineConfig({
  testDir: "./tests/workos",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.WORKOS_BASE_URL ?? "https://localhost:3443",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
