import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    // Mirrors the `@/…` paths in tsconfig.json that the components use.
    alias: [
      // Shared navigation tests exercise the web URL hook with its real helper.
      { find: /^@\/lib\/module-tab-navigation$/, replacement: fileURLToPath(new URL("../../web/lib/module-tab-navigation.ts", import.meta.url)) },
      { find: /^@\/components\/ui\/(.*)$/, replacement: src("components/$1") },
      { find: /^@\/lib\/(.*)$/, replacement: src("lib/$1") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup-dom.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
