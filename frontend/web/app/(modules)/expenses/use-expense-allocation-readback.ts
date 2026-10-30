"use client"

import { useEffect, useRef, useState } from "react"
import { useExpenseAllocations, type ExpenseAllocationsScope } from "@lumiere/query-hooks/hooks/expenses-allocations"
import type { ExpenseAllocationDraft } from "@lumiere/ui/forms/expense-allocation-lines"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { expenseAllocationFingerprint, savedExpenseAllocationDrafts } from "./expense-allocation-input"

interface AllocationSnapshot {
  scope: string
  rows: ExpenseAllocationDraft[]
  fingerprint: string
  serverSnapshot: string
}

/** Bind an editor once to a verified read; subsequent refreshes never replace entered rows. */
export function useExpenseAllocationReadback(scope: ExpenseAllocationsScope, invalidMessage: string, changedMessage: string) {
  const query = useExpenseAllocations(scope)
  const key = `${scope.identity ?? ""}:${scope.organizationId}:${scope.companyId}:${scope.expenseId ?? ""}`
  const admitted = scope.enabled !== false
  const currentScope = useRef({ key, admitted, mounted: false })
  if (currentScope.current.key !== key || currentScope.current.admitted !== admitted) {
    currentScope.current = { key, admitted, mounted: false }
  }
  // Returning to the same key creates a new editor lifetime; old reads cannot resume.
  const lifetime = currentScope.current
  useEffect(() => {
    lifetime.mounted = true
    return () => { lifetime.mounted = false }
  }, [lifetime])
  const assertCurrentAdmission = () => {
    if (currentScope.current !== lifetime || !lifetime.mounted || !lifetime.admitted) throw new Error(invalidMessage)
  }
  const [snapshot, setSnapshot] = useState<AllocationSnapshot | null>(null)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const failureStatus = query.error && typeof query.error === "object" && "status" in query.error ? query.error.status : undefined
  const state = failureStatus === 404 || failureStatus === 410 ? { status: "denied" as const } : moduleQueryState({ ...query, data: query.data?.rows })
  const activeSnapshot = state.status !== "denied" && snapshot?.scope === key ? snapshot : null
  useEffect(() => {
    setSnapshot(null)
    setDecodeError(null)
  }, [key])
  useEffect(() => {
    if (state.status === "denied") {
      setSnapshot(null)
      return
    }
    if (scope.enabled === false || !scope.expenseId || !query.isSuccess || query.isFetching || activeSnapshot || !query.data) return
    try {
      const rows = savedExpenseAllocationDrafts(query.data.rows, scope.organizationId, scope.companyId, scope.expenseId, invalidMessage)
      setSnapshot({ scope: key, rows, fingerprint: expenseAllocationFingerprint(query.data.rows), serverSnapshot: query.data.snapshot })
      setDecodeError(null)
    } catch {
      setDecodeError(invalidMessage)
    }
  }, [key, state.status, scope.enabled, scope.expenseId, scope.organizationId, scope.companyId, query.isSuccess, query.isFetching, query.data, activeSnapshot, invalidMessage])
  const changed = Boolean(activeSnapshot && query.isSuccess && query.data && (expenseAllocationFingerprint(query.data.rows) !== activeSnapshot.fingerprint || query.data.snapshot !== activeSnapshot.serverSnapshot))
  const ready = Boolean(scope.enabled !== false && activeSnapshot && state.status === "ready" && !query.isFetching && !decodeError && !changed)
  return {
    rows: activeSnapshot?.rows,
    initialized: Boolean(activeSnapshot),
    state,
    ready,
    error: decodeError ?? (changed ? changedMessage : null),
    retry: () => { void query.refetch() },
    assertCurrentAdmission,
    verifyBeforeSave: async () => {
      assertCurrentAdmission()
      if (!ready || !activeSnapshot || !scope.expenseId) throw new Error(invalidMessage)
      const refreshed = await query.refetch({ throwOnError: true })
      assertCurrentAdmission()
      if (!refreshed.data) throw new Error(invalidMessage)
      savedExpenseAllocationDrafts(refreshed.data.rows, scope.organizationId, scope.companyId, scope.expenseId, invalidMessage)
      if (expenseAllocationFingerprint(refreshed.data.rows) !== activeSnapshot.fingerprint || refreshed.data.snapshot !== activeSnapshot.serverSnapshot) throw new Error(changedMessage)
      return refreshed.data.snapshot
    },
  }
}
