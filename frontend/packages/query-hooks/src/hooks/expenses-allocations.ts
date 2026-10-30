"use client"

import { useQuery } from "@tanstack/react-query"
import { decodeQueryListResponse, QueryResponseDecodeError } from "@lumiere/api-client"
import { httpResponseError } from "@lumiere/api-client/response-error"
import { apiFetch } from "../http"

export interface ExpenseAllocationReadRow {
  id?: unknown
  organizationId?: unknown
  companyId?: unknown
  expenseId?: unknown
  projectId?: unknown
  analyticAccountId?: unknown
  sharePercent?: unknown
  amount?: unknown
  billable?: unknown
  metadata?: unknown
}

function allocationRow(value: unknown): ExpenseAllocationReadRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QueryResponseDecodeError("Expense allocation must be an object")
  }
  return value as ExpenseAllocationReadRow
}

export interface ExpenseAllocationsScope {
  organizationId: bigint
  companyId: bigint
  expenseId: bigint | undefined
  identity: string | null
  enabled?: boolean
}

export function expenseAllocationsQueryOptions(scope: ExpenseAllocationsScope) {
  const allowed = scope.enabled !== false && scope.organizationId > 0n && scope.companyId > 0n
    && scope.expenseId !== undefined && scope.expenseId > 0n && Boolean(scope.identity && scope.identity !== "unknown")
  return {
    queryKey: ["expense-allocations", String(scope.organizationId), scope.identity,
      String(scope.companyId), String(scope.expenseId ?? "")] as const,
    queryFn: async () => {
      if (!allowed) throw new Error("An actor, company and expense are required to read allocations")
      const query = new URLSearchParams({ companyId: String(scope.companyId), expenseId: String(scope.expenseId) })
      const path: string = `/api/query/expense-allocations?${query}`
      const response = await apiFetch(path)
      if (!response.ok) throw await httpResponseError(response, "Failed to read this expense's saved allocations")
      return decodeQueryListResponse(await response.json(), allocationRow)
    },
    enabled: allowed,
    staleTime: 0,
    retry: false as const,
  }
}

export function useExpenseAllocations(scope: ExpenseAllocationsScope) {
  return useQuery(expenseAllocationsQueryOptions(scope))
}
