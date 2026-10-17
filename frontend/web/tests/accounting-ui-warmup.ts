import { request, type FullConfig } from "@playwright/test"

/** Compile the isolated Next routes before browser interaction timeouts begin. */
export default async function warmAccountingUiRoutes(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL })
  try {
    for (const route of ["/", "/style-templates", "/personalization", "/workflows", "/insights", "/module-insights", "/navigation", "/api/documents/blobs/object/7/synthetic/0123456789abcdef0123456789abcdef?sha256=f5438451863fbb1cb2224cbd6a823fa594b429dd3ce2f26c8c0f05bd3f971429"]) {
      const response = await context.get(route, { timeout: 120_000 })
      if (!response.ok()) throw new Error(`Synthetic UI fixture warmup failed for ${route}: HTTP ${response.status()}`)
    }
  } finally { await context.dispose() }
}
