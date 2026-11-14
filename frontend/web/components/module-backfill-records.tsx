"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiFetch } from "@/lib/api-fetch"
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation"

export type BackfillModule = "sales" | "warehouse"

type Facts =
  | {
      kind: "sales"
      customer: string
      product: string
      quantity: string
      unit: string | null
      unitPrice: string
      amount: string
      currency: string
      reportedPayment: string | null
    }
  | {
      kind: "warehouse"
      product: string
      pieces: string
      kilograms: string
      location: string | null
    }

type Page = {
  data: Array<{
    id: string
    batchId: string
    itemId: string
    sourceRevision: number
    sourceFile: string
    sourceRow: number
    periodStart: string
    periodEnd: string
    facts: Facts
  }>
  nextBeforeId: string | null
}

export function ModuleBackfillRecords({
  organizationId,
  module,
}: {
  organizationId: number
  module: BackfillModule
}) {
  const companyId = useOperatingCompanyId(organizationId)
  const {
    identity,
    activeCompanyReady,
    organizationId: activeOrganization,
  } = useErpSession()
  const { isAdmin, permissionsReady } = useRBAC()
  const enabled = !!(
    permissionsReady &&
    isAdmin() &&
    activeCompanyReady &&
    activeOrganization === organizationId &&
    identity &&
    companyId
  )
  const records = useInfiniteQuery({
    queryKey: ["module-backfill", organizationId, companyId, identity, module],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      const params = new URLSearchParams({ companyId: String(companyId) })
      if (pageParam) params.set("beforeId", pageParam)
      const response = await apiFetch(
        `/api/module-backfill/${module}?${params}`,
        { signal },
      )
      if (!response.ok)
        throw new Error("Backfilled records could not be loaded.")
      return response.json()
    },
    getNextPageParam: (last) => last.nextBeforeId ?? undefined,
  })
  if (!enabled || !companyId) return null

  const sales = module === "sales"
  const title = sales
    ? "Backfilled customer sales"
    : "Backfilled inventory counts"
  const rows = records.data?.pages.flatMap((page) => page.data) ?? []
  const headers = sales
    ? [
        "Period",
        "Customer",
        "Product",
        "Quantity",
        "Unit price",
        "Reported total",
        "Payment comment",
        "Source",
      ]
    : ["Count date", "Product", "Pieces", "Kilograms", "Location", "Source"]

  return (
    <section
      id="backfilled-records"
      aria-label={title}
      className="mx-4 my-3 space-y-3 rounded-lg border p-4"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {records.isPending ? <p role="status">Loading records…</p> : null}
      {records.isError ? (
        <div role="alert">
          <p>Backfilled records could not be loaded.</p>
          <Button variant="outline" onClick={() => void records.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {records.isSuccess && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No backfilled records yet.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.periodStart === row.periodEnd
                    ? row.periodStart
                    : `${row.periodStart} – ${row.periodEnd}`}
                </TableCell>
                {row.facts.kind === "sales" ? (
                  <>
                    <TableCell>{row.facts.customer}</TableCell>
                    <TableCell>{row.facts.product}</TableCell>
                    <TableCell>
                      {[row.facts.quantity, row.facts.unit]
                        .filter(Boolean)
                        .join(" ")}
                    </TableCell>
                    <TableCell>
                      {row.facts.unitPrice} {row.facts.currency}
                    </TableCell>
                    <TableCell>
                      {row.facts.amount} {row.facts.currency}
                    </TableCell>
                    <TableCell>{row.facts.reportedPayment ?? "—"}</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>{row.facts.product}</TableCell>
                    <TableCell>{row.facts.pieces}</TableCell>
                    <TableCell>{row.facts.kilograms}</TableCell>
                    <TableCell>{row.facts.location ?? "Unspecified"}</TableCell>
                  </>
                )}
                <TableCell>
                  <a
                    className="underline underline-offset-4"
                    href={sourceReviewHistoryHref(String(companyId), {
                      batchId: row.batchId,
                      itemId: row.itemId,
                      revision: row.sourceRevision,
                    })}
                  >
                    {row.sourceFile} · row {row.sourceRow}
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {records.hasNextPage ? (
        <Button
          variant="outline"
          disabled={records.isFetchingNextPage}
          onClick={() => void records.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </section>
  )
}
