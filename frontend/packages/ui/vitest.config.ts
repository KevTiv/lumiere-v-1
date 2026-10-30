import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    // Mirrors the `@/…` paths in tsconfig.json that the components use.
    alias: [
      { find: /^@lumiere\/ui\/(.*)$/, replacement: src("$1") },
      // Shared navigation tests exercise the web URL hook with its real helper.
      { find: /^@\/lib\/module-tab-navigation$/, replacement: fileURLToPath(new URL("../../web/lib/module-tab-navigation.ts", import.meta.url)) },
      // Guide host regressions mount the production modal and dedicated-page owners.
      { find: /^@\/lib\/assistant-guide-context$/, replacement: fileURLToPath(new URL("../../web/lib/assistant-guide-context.tsx", import.meta.url)) },
      { find: /^@\/lib\/(assistant-guides|ai-workspace-scope|record-page-href)$/, replacement: fileURLToPath(new URL("../../web/lib/$1.ts", import.meta.url)) },
      // Mounted feature tests use the production web form adapters, not UI helpers.
      { find: /^@\/lib\/(inventory-ext-params|form-lookup|stb-timestamp|id-list|org-scoped)$/, replacement: fileURLToPath(new URL("../../web/lib/$1.ts", import.meta.url)) },
      { find: /^@\/components\/ui\/(.*)$/, replacement: src("components/$1") },
      { find: /^@\/lib\/(.*)$/, replacement: src("lib/$1") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup-dom.ts", "./src/test-setup-storage.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
