import { request, type FullConfig } from "@playwright/test"

/** Compile the isolated Next routes before browser interaction timeouts begin. */
export default async function warmAccountingUiRoutes(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL })
  try {
    for (const route of ["/guided-workflows", "/", "/style-templates", "/personalization", "/workflows", "/insights", "/module-insights", "/navigation", "/authoring-refinement", "/usability-forms", "/harness-inspector", "/list-toolbar", "/operations"]) {
      const response = await context.get(route, { timeout: route === "/operations" ? 600_000 : 120_000 })
      if (!response.ok()) throw new Error(`Synthetic UI fixture warmup failed for ${route}: HTTP ${response.status()}`)
    }
  } finally { await context.dispose() }
}
