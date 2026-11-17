import { z } from "zod"
import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { isPersonalPageModule } from "@lumiere/presentation-core/personal-page-layout"
import { apiFetch } from "./api-fetch"

const decimal = z.string().regex(/^[1-9][0-9]{0,19}$/)
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64)
const requestId = z.string().uuid()
const receiptSchema = z.object({
  sessionKey: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  messageId: decimal,
  requestId,
  moduleId: slug.refine(isPersonalPageModule),
  pageId: slug,
  widgetId: decimal,
  layoutRevision: decimal,
})

export type AssistantWidgetReceipt = z.infer<typeof receiptSchema>
export const assistantWidgetReceiptQueryKey = (
  scopeKey: string | null,
  sessionKey: string | null,
) => ["assistant-widget-receipts", scopeKey, sessionKey] as const

export async function readAssistantWidgetReceipts(
  companyId: number,
  sessionKey: string,
  messageIds: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    companyId: String(companyId),
    sessionKey,
    messageIds,
  })
  const response = await apiFetch("/api/ai/chat/widget-receipts?" + query, {
    signal,
    cache: "no-store",
  })
  if (!response.ok) throw new Error("Saved widget history is unavailable")
  const result = z
    .object({ data: z.array(receiptSchema).max(90) })
    .parse(await response.json())
  if (result.data.some((receipt) => receipt.sessionKey !== sessionKey))
    throw new Error("Saved widget history changed")
  return result.data
}

export async function saveAssistantWidgetReceipt(
  companyId: string,
  payload: AssistantWidgetReceipt,
) {
  const expected = receiptSchema.parse(payload)
  const response = await apiFetch("/api/ai/chat/widget-receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...expected, companyId }),
  })
  if (!response.ok) throw new Error("Saved widget history is unavailable")
  const receipt = receiptSchema.parse(await response.json())
  if (JSON.stringify(receipt) !== JSON.stringify(expected))
    throw new Error("Saved widget history changed")
  return receipt
}

export function assistantWidgetReceiptHref(
  receipt: AssistantWidgetReceipt,
  companyId: number,
): string {
  const exact = receiptSchema.parse(receipt)
  const href = moduleTabHref(exact.moduleId, exact.pageId)
  const url = new URL(href, "https://lumiere.invalid")
  url.searchParams.set("savedWidget", exact.widgetId)
  url.searchParams.set("savedWidgetCompany", String(companyId))
  url.searchParams.set("savedWidgetPlacement", `assistant-${exact.requestId}`)
  return url.pathname + url.search
}
