import { request, type FullConfig } from "@playwright/test"

/** Compile both production-component fixtures before browser action timeouts. */
export default async function warmWorkspaceNavigation(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL })
  try {
    for (const route of ["/style-templates", "/navigation"]) {
      const response = await context.get(route, { timeout: 120_000 })
      if (!response.ok()) throw new Error(`Workspace UI fixture warmup failed for ${route}: HTTP ${response.status()}`)
    }
  } finally { await context.dispose() }
}
