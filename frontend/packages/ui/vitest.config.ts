import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    // Mirrors the `@/…` paths in tsconfig.json that the components use.
    alias: [
      { find: /^@\/components\/ui\/(.*)$/, replacement: src("components/$1") },
      { find: /^@\/lib\/(.*)$/, replacement: src("lib/$1") },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
