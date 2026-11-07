import "server-only"

import type { RagUiContext } from "@lumiere/erp-shared/ai-ui-context"
import {
  ASSISTANT_PAGE_WIDGET_LIMIT,
  isAssistantPageModule,
  parseAssistantActionId,
  parseAssistantPageId,
  type AssistantPageCatalog,
  type AssistantPageWidget,
} from "@lumiere/query-hooks/assistant-actions"
import type { ApiSession } from "@/lib/api-session"
import { serverFetchQueryListState } from "@/lib/server-query"

import { serverRagUiActionOffers } from "./rag-ui-actions"

function rowId(value: unknown): string | undefined {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    return undefined
  return parseAssistantActionId(
    typeof value === "bigint" || typeof value === "number"
      ? String(value)
      : value,
  )
}

/** Native query rows are camel-cased; preserve explicit null for org-shared widgets. */
function rowField(row: Record<string, unknown>, camel: string, snake: string) {
  return Object.hasOwn(row, camel) ? row[camel] : row[snake]
}

function scopedWidgets(
  rows: readonly unknown[],
  organizationId: number,
  companyId: number,
): AssistantPageWidget[] {
  const widgets: AssistantPageWidget[] = []
  const seen = new Set<string>()
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const row = value as Record<string, unknown>
    const id = rowId(row.id)
    const organization = rowId(
      rowField(row, "organizationId", "organization_id"),
    )
    const company = rowField(row, "companyId", "company_id")
    const active = rowField(row, "isActive", "is_active")
    const label = typeof row.name === "string" ? row.name.trim() : ""
    if (
      !id ||
      organization !== String(organizationId) ||
      (company !== null && rowId(company) !== String(companyId)) ||
      active !== true ||
      !label ||
      label.length > 120 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(label) ||
      seen.has(id)
    )
      continue
    seen.add(id)
    widgets.push({ key: `saved:${id}`, label })
    if (widgets.length === ASSISTANT_PAGE_WIDGET_LIMIT) break
  }
  return widgets
}

/**
 * Call after the top-level company has passed the RAG route's company-scope check.
 * Browser context selects a native surface only. Widget identities and labels
 * come exclusively from an authenticated, policy-filtered server query.
 */
export async function serverRagPageCatalog(params: {
  session: ApiSession
  orgId: number
  companyId: number
  uiContext?: RagUiContext
}): Promise<AssistantPageCatalog | undefined> {
  const { session, orgId, companyId, uiContext } = params
  if (
    !isAssistantPageModule(uiContext?.module) ||
    !Number.isSafeInteger(orgId) ||
    orgId <= 0 ||
    session.organizationId !== orgId ||
    !Number.isSafeInteger(companyId) ||
    companyId <= 0
  )
    return undefined
  const pageId = parseAssistantPageId(uiContext.active_tab ?? "dashboard")
  if (!pageId) return undefined
  const page: AssistantPageCatalog = {
    moduleId: uiContext.module,
    pageId,
    widgets: [],
  }
  // Reuse native discovery policy; context.permissions is never an authority.
  if (
    !serverRagUiActionOffers(session, page).some(
      (offer) => offer.kind === "add_widget",
    )
  )
    return undefined
  try {
    const result = await serverFetchQueryListState(session, "dashboard-widgets")
    if (result.status === "ready")
      page.widgets = scopedWidgets(result.rows, orgId, companyId)
  } catch {
    // Saved-widget discovery is optional. Keep the native composer available;
    // an unavailable read never creates widget choices or authorizes a write.
  }
  return page
}
