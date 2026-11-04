import { request, type FullConfig } from "@playwright/test"

/** Compile the actual shell routes before measuring browser interactions. */
export default async function warmChatLayout(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL })
  try {
    for (const route of ["/", "/chat-workspace", "/accounting/invoices/9007199254741000"]) {
      const response = await context.get(route, { timeout: 120_000 })
      if (!response.ok()) throw new Error(`Chat layout fixture warmup failed for ${route}: HTTP ${response.status()}`)
    }
  } finally {
    await context.dispose()
  }
}
