import { parseCsvText } from "@lumiere/erp-shared/csv-import-safety"
import { z } from "zod"
import { apiFetch } from "./api-fetch"
import { importsPausedFrom } from "./import-write-pause"

const positiveId = z.string().regex(/^[1-9]\d{0,18}$/)
const sourceRow = z.object({
  batchId: positiveId,
  itemId: positiveId,
  revision: z.number().int().positive().max(2_147_483_647),
})
type SourceRow = z.infer<typeof sourceRow>
type BackfillRow = SourceRow & { expectedDigest: string; customerId?: string }

type Approval = { companyId: number; rows: SourceRow[] } & (
  | {
    adapter: "tracked_master_data"
    config: { entity: "product" | "contact" | "stock_location"; csvData: string; fileName: string; currencyId?: string }
  }
  | {
    adapter: "sales" | "shop_sales" | "warehouse"
    config: { rows: BackfillRow[] }
  }
)

export function approvedMasterDataRows(csv: string, batchId: string): SourceRow[] {
  const { headers, rows } = parseCsvText(csv)
  const item = headers.indexOf("_review_item_id")
  const revision = headers.indexOf("_review_revision")
  if (item < 0 || revision < 0 || rows.length === 0) throw new Error("Reopen the saved review before importing.")
  const parsed = rows.map(row => sourceRow.parse({
    batchId,
    itemId: row[item],
    revision: /^[1-9]\d*$/.test(row[revision] ?? "") ? Number(row[revision]) : NaN,
  }))
  if (new Set(parsed.map(row => row.itemId)).size !== parsed.length) {
    throw new Error("The reviewed export contains a duplicate row identity.")
  }
  return parsed
}

export async function startDurableImportRun(taskId: string, approval: Approval) {
  const input = new TextEncoder().encode(JSON.stringify([taskId, approval]))
  const digest = await crypto.subtle.digest("SHA-256", input)
  const requestId = Array.from(new Uint8Array(digest).slice(0, 16), byte =>
    byte.toString(16).padStart(2, "0")).join("")
  const response = await apiFetch("/api/import-tasks/" + encodeURIComponent(taskId) + "/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...approval, requestId }),
  })
  if (!response.ok) {
    const paused = await importsPausedFrom(response)
    if (paused) throw paused
    const body: unknown = await response.json().catch(() => null)
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") throw new Error(body.error)
    throw new Error("Check the saved task before retrying the import.")
  }
  const run = z.object({
    id: z.string().regex(/^[0-9a-f]{64}$/),
    taskId: z.literal(taskId),
    adapter: z.literal(approval.adapter),
  }).parse(await response.json())
  return run.id
}
