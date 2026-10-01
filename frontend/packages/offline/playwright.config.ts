import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: "chromium",
    launchOptions: {
      ...(process.env.LUMIERE_CHROMIUM_PATH
        ? { executablePath: process.env.LUMIERE_CHROMIUM_PATH }
        : {}),
    },
  },
  webServer: {
    command: "node --import tsx tests/browser/server.ts",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
  },
});
