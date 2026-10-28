import { request, type FullConfig } from '@playwright/test';

/** Compile production-component fixture routes before browser action timeouts start. */
export default async function warmSalesWorkflow(config: FullConfig) {
  const context = await request.newContext({ baseURL: config.projects[0]?.use.baseURL });
  try {
    for (const route of ['/sales-workflow', '/helper-regressions', '/sales?module=sales&defaultTab=orders']) {
      const response = await context.get(route, { timeout: 120_000 });
      if (!response.ok()) throw new Error(`Sales UI fixture warmup failed for ${route}: HTTP ${response.status()}`);
    }
  } finally { await context.dispose(); }
}
