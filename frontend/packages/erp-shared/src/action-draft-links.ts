import { resolveAiSourceHref } from "./ai-source-links"
import type { ScalarId } from "./u64"

const REDUCER_ENTITY_MAP: Record<string, string> = {
  create_task: "project_task",
  create_sale_order: "sale_order",
  create_purchase_order: "purchase_order",
}

/** Deep link to the ERP record created when a draft was approved. */
export function resolveActionDraftRecordHref(
  reducerName: string,
  recordId?: ScalarId | null,
): string | undefined {
  if (recordId == null) return undefined
  const entityType = REDUCER_ENTITY_MAP[reducerName.trim()]
  if (!entityType) return undefined
  return resolveAiSourceHref({
    entity_type: entityType,
    entity_id: recordId,
  })
}
