import { request, type FullConfig } from "@playwright/test"

export default async function warmProductivity(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL })
  try {
    for (const route of ["/productivity", "/navigation?module=documents"]) {
      const response = await context.get(route, { timeout: 120_000 })
      if (!response.ok()) throw new Error(`Productivity fixture warmup failed for ${route}: HTTP ${response.status()}`)
    }
  } finally { await context.dispose() }
}
