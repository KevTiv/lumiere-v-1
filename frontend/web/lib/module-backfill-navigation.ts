import { moduleBackfillHref, type BackfillModule } from "@lumiere/erp-shared/record-links"
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state"
import type { ModuleHistoryFilter } from "@lumiere/ui/lib/module-history-filter"
import type { ErpSessionState } from "@lumiere/erp-session"

export {
  isModuleBackfillRecordId,
  moduleBackfillHref,
  moduleBackfillRecordHref,
  moduleBackfillTabs,
  type BackfillModule,
} from "@lumiere/erp-shared/record-links"

export function moduleBackfillReadScope(
  session: Pick<ErpSessionState, "identity" | "organizationId" | "activeCompanyId" | "activeCompanyReady" | "companyIds">,
  organizationId: number,
  canRead: boolean,
) {
  const { identity, activeCompanyId: companyId, activeCompanyReady, companyIds } = session
  if (
    !canRead || session.organizationId !== organizationId || !identity ||
    activeCompanyReady !== true || companyId == null || !companyIds?.includes(companyId)
  ) return null
  return { identity, companyId }
}

export function moduleBackfillEmptyHref(
  module: Exclude<BackfillModule, "shop_sales">,
  { canRead, status, nativeRowCount, history }: {
    canRead: boolean
    status: ModuleDataState["status"]
    nativeRowCount: number
    history?: ModuleHistoryFilter
  },
) {
  if (!canRead || status !== "ready" || nativeRowCount !== 0) return undefined
  if (history && history.status !== "inactive" && !(history.status === "active" && history.period === "all")) return undefined
  return moduleBackfillHref(module)
}
