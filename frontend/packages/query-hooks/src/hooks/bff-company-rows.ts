"use client"

/**
 * Reads parent-scoped resources that fail closed on the subscription path
 * (see crates/stdb-auth/src/erp_subscriptions.rs). They are only served by the authorized
 * HTTP query path `/api/query/<key>?companyId=<active company>`, exactly like the
 * BFF-only `depreciation-lines` / `landed-cost-lines` reads. The BFF performs the company
 * filtering; HTTP or response decoding failures surface as query errors, not empty lists.
 */

import { decodeQueryListResponse } from "@lumiere/api-client"
import { useErpSession } from "@lumiere/erp-session"
import { useQuery } from "@tanstack/react-query"

import { apiFetch } from "../http"
import { mapRows } from "./read-ui-rows"
import {
  toBankStatementImportLineRow,
  toConsolidationCompanyRateRow,
  toStatementLineRow,
  toTaxDeadlineReminderRow,
  type BankStatementImportLineRow,
  type ConsolidationCompanyRateRow,
  type StatementLineRow,
  type TaxDeadlineReminderRow,
} from "./read-ui-rows"

type BffCompanyResource =
  | "profit-loss-lines"
  | "balance-sheet-lines"
  | "cash-flow-lines"
  | "bank-statement-import-lines"
  | "tax-deadline-reminders"
  | "consolidation-company-rates"

type Options = { staleTime?: number; enabled?: boolean }

function useBffCompanyRows<Row>(
  resource: BffCompanyResource,
  organizationId: bigint | number,
  mapper: (row: Record<string, unknown>) => Row | null,
  options?: Options,
) {
  const { activeCompanyId, activeCompanyReady } = useErpSession()
  const companyId = activeCompanyReady ? activeCompanyId : null
  const orgKey = organizationId.toString()
  const orgOk = typeof organizationId === "bigint" ? organizationId > 0n : organizationId > 0
  return useQuery<Row[]>({
    queryKey: ["typed-stdb", resource, orgKey, "company", companyId] as const,
    queryFn: async () => {
      if (companyId == null || companyId <= 0) {
        throw new Error(`An active company is required to query ${resource}`)
      }
      const response = await apiFetch(
        `/api/query/${resource}?companyId=${encodeURIComponent(String(companyId))}`,
      )
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? `Query ${resource} failed`)
      }
      const raw = decodeQueryListResponse(
        await response.json(),
        (row) => row as Record<string, unknown>,
      )
      return mapRows(raw, mapper)
    },
    enabled:
      (options?.enabled ?? true) && orgOk && activeCompanyReady && companyId != null && companyId > 0,
    staleTime: options?.staleTime ?? 30_000,
  })
}

export function useProfitLossLines(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<StatementLineRow>("profit-loss-lines", organizationId, toStatementLineRow, options)
}

export function useBalanceSheetLines(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<StatementLineRow>("balance-sheet-lines", organizationId, toStatementLineRow, options)
}

export function useCashFlowLines(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<StatementLineRow>("cash-flow-lines", organizationId, toStatementLineRow, options)
}

export function useBankStatementImportLines(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<BankStatementImportLineRow>(
    "bank-statement-import-lines",
    organizationId,
    toBankStatementImportLineRow,
    options,
  )
}

export function useTaxDeadlineReminders(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<TaxDeadlineReminderRow>(
    "tax-deadline-reminders",
    organizationId,
    toTaxDeadlineReminderRow,
    options,
  )
}

export function useConsolidationCompanyRates(organizationId: bigint | number, options?: Options) {
  return useBffCompanyRows<ConsolidationCompanyRateRow>(
    "consolidation-company-rates",
    organizationId,
    toConsolidationCompanyRateRow,
    options,
  )
}
