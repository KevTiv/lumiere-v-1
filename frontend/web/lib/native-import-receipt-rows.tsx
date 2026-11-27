"use client"

import { useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { useTranslation } from "@lumiere/i18n"
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation"
import { Button } from "@/components/ui/button"
import { apiFetch } from "./api-fetch"
import { readNativeReceiptRows, type ImportNativeResult, type WorkflowScope } from "./import-workflow"

const destinations = {
  product: ["products", "products"],
  contact: ["crm", "contacts"],
  stock_location: ["warehouse", "locations"],
} as const

export function NativeImportReceiptRows({ actor, scope, result }: {
  actor: string
  scope: WorkflowScope
  result: ImportNativeResult
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rows = useInfiniteQuery({
    queryKey: ["native-import-receipt-rows", actor, scope.organizationId, scope.companyId, scope.taskId, result.requestId, result.receipt?.status],
    enabled: open,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => readNativeReceiptRows(apiFetch, scope, result, pageParam),
    getNextPageParam: (page) => page.nextRow ?? undefined,
    retry: false,
  })
  const [module, tab] = destinations[result.entity]
  const labels = {
    verified: t("settings.importWorkflow.receiptRowVerified"),
    failed: t("settings.importWorkflow.receiptRowFailed"),
    rolled_back: t("settings.importWorkflow.receiptRowRolledBack"),
    unverified: t("settings.importWorkflow.receiptRowUnverified"),
  }

  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-pointer py-2 underline">{t("settings.importWorkflow.receiptRows")}</summary>
    {open && <div className="space-y-2">
      {rows.isPending && <p role="status">{t("common.loading")}</p>}
      {rows.isError && <div className="space-y-2">
        <p role="alert">{t("settings.importWorkflow.receiptRowsUnavailable")}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void (rows.isFetchNextPageError ? rows.fetchNextPage() : rows.refetch())}>{t("common.retry")}</Button>
      </div>}
      {!rows.isError && <ul className="divide-y">
        {rows.data?.pages.flatMap(page => page.rows).map(row => <li key={row.importRow} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
          <span className="break-all">{row.sourceFile && row.sourceRow != null
            ? t("settings.importWorkflow.receiptSourceRow", { file: row.sourceFile, row: row.sourceRow })
            : t("settings.importWorkflow.receiptExportRow", { row: row.importRow })}</span>
          <span>{labels[row.state]}</span>
          {row.batchId && row.itemId && row.revision != null && <a className="underline" href={sourceReviewHistoryHref(String(scope.companyId), { batchId: row.batchId, itemId: row.itemId, revision: row.revision })}>
            {t("settings.importWorkflow.receiptOpenSource")}</a>}
          {row.recordId && <a className="underline" href={moduleTabHref(module, tab, { id: row.recordId })}>
            {t("settings.importWorkflow.receiptOpenRecord", { id: row.recordId })}</a>}
        </li>)}
      </ul>}
      {!rows.isError && rows.hasNextPage && <Button type="button" size="sm" variant="outline" disabled={rows.isFetching} onClick={() => void rows.fetchNextPage()}>
        {rows.isFetchingNextPage ? t("common.loading") : t("settings.importWorkflow.receiptMoreRows")}
      </Button>}
    </div>}
  </details>
}
