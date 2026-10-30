"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { fetchQueryListState } from "@lumiere/query-hooks/http"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { Button } from "@lumiere/ui/components/button"
import { approvalSourceResource, approvalSourceSummary } from "./approval-source-summary"

/** Supplementary current record details; private approval snapshots remain with the workflow owner. */
export function ApprovalSourceDetails({ organizationId, companyId, model, subjectId }: { organizationId: number; companyId: number; model: string; subjectId: string }) {
  const { t, i18n } = useTranslation()
  const session = useErpSession()
  const { currentUser, roles, policies, permissionsReady, checkPermission } = useRBAC()
  const source = approvalSourceResource(model)
  const allowed = source != null && permissionsReady === true && session.organizationId === organizationId && currentUser?.id === session.identity
    && checkPermission(source.permission, "read").allowed
  const query = useQuery({
    queryKey: ["approval-source-details", organizationId, companyId, session.identity, JSON.stringify({ currentUser, roles, policies }), source?.resource],
    enabled: allowed,
    staleTime: 0,
    queryFn: () => fetchQueryListState(`/api/query/${source!.resource}?companyId=${companyId}`),
  })
  const currencies = useCurrencies()
  if (!allowed) return <p className="text-xs text-muted-foreground">{t("approvals.review.detailsRestricted", { defaultValue: "Business details are not available through your source-record access. Open the owning workspace for permitted review." })}</p>
  if (query.isPending || query.isFetching) return <p role="status" className="text-xs text-muted-foreground">{t("approvals.review.detailsLoading", { defaultValue: "Checking current business record…" })}</p>
  if (query.isError || query.data?.status === "unavailable" || query.data?.status === "denied") return <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><p>{t("approvals.review.detailsFailed", { defaultValue: "Current business details could not be verified. No amount or party is assumed." })}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t("common.retry")}</Button></div>
  const summary = approvalSourceSummary(query.data?.rows ?? [], subjectId, organizationId, companyId, currencies.isError || currencies.isFetching ? [] : currencies.data ?? [], i18n.language)
  return <div className="space-y-1 text-sm" data-testid={`approval-source-${model}-${subjectId}`}>
    {summary?.reference && <p className="break-words font-medium">{summary.reference}</p>}
    {summary?.party && <p className="break-words">{summary.party}</p>}
    {summary?.money && <p className="font-medium tabular-nums">{summary.money}</p>}
    <p className="text-xs text-muted-foreground">{summary ? t("approvals.review.currentDetails", { defaultValue: "Current authorized record details; this is not a frozen approval snapshot. Open the source to verify the requested change before deciding." }) : t("approvals.review.detailsMissing", { defaultValue: "The exact source record is unavailable or outside your current scope. No substitute record is shown." })}</p>
  </div>
}
