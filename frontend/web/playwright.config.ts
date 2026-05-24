import { defineConfig, devices } from "@playwright/test"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const readinessURL = process.env.PLAYWRIGHT_BASE_URL ? baseURL : `${baseURL}/sign-in`

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
        url: readinessURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        // Build/start with relative `/api/*` so the browser stays same-origin with
        // `baseURL` (127.0.0.1). A `.env.local` `NEXT_PUBLIC_API_GATEWAY_URL=http://localhost:8082`
        // otherwise forces cross-origin fetches (`localhost` ≠ `127.0.0.1` Origin) unless
        // api-server `CORS_ORIGINS` lists the page origin.
        env: {
          ...process.env,
          NEXT_PUBLIC_API_GATEWAY_URL: "",
        },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
