/**
 * Accounting hooks — Phase 4 of API Gateway Refactor
 *
 * Wraps REST API calls with React Query for the Accounting module.
 * All hooks accept organizationId: bigint matching the stdb hooks interface.
 *
 * Notes:
 * - useBankStatements and useFixedAssets return empty arrays (no route yet)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchQueryList, emptyQueryRows, type QueryRows } from '@/lib/query-fetch'

function invalidateAccountingQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  const org = organizationId.toString()
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['account-accounts', org] }),
    qc.invalidateQueries({ queryKey: ['account-moves', org] }),
    qc.invalidateQueries({ queryKey: ['account-taxes', org] }),
    qc.invalidateQueries({ queryKey: ['budgets', org] }),
    qc.invalidateQueries({ queryKey: ['analytic-accounts', org] }),
    qc.invalidateQueries({ queryKey: ['bank-statements', org] }),
  ])
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useAccountAccounts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['account-accounts', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/account-accounts', 'Failed to fetch account accounts'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAccountJournals(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['account-journals', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/account-journals', 'Failed to fetch account journals'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAccountMoves(
  organizationId: bigint,
  _moveType?: string,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['account-moves', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/account-moves', 'Failed to fetch account moves'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAccountTaxes(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['account-taxes', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/account-taxes', 'Failed to fetch account taxes'),
    staleTime: 30_000,
    initialData,
  })
}

export function useBudgets(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['budgets', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/budgets', 'Failed to fetch budgets'),
    staleTime: 30_000,
    initialData,
  })
}

export function useAnalyticAccounts(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['analytic-accounts', organizationId.toString()],
    queryFn: () => fetchQueryList('/api/query/analytic-accounts', 'Failed to fetch analytic accounts'),
    staleTime: 30_000,
    initialData,
  })
}

// TODO: No route yet — returns empty array until bank_statement table/route is added
export function useBankStatements(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['bank-statements', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// TODO: No route yet — returns empty array until fixed_asset table/route is added
export function useFixedAssets(
  organizationId: bigint,
  initialData?: QueryRows,
) {
  return useQuery<QueryRows>({
    queryKey: ['fixed-assets', organizationId.toString()],
    queryFn: emptyQueryRows,
    staleTime: 30_000,
    initialData: initialData ?? [],
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateAccount(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_account_account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create account')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-accounts', organizationId.toString()] }),
  })
}

export function useCreateMove(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_account_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create move')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-moves', organizationId.toString()] }),
  })
}

export function useCreateTax(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_account_tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create tax')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['account-taxes', organizationId.toString()] }),
  })
}

export function useCreateBudget(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_crossovered_budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create budget')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', organizationId.toString()] }),
  })
}

export function useCreateAnalyticAccount(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_analytic_account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create analytic account')
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['analytic-accounts', organizationId.toString()] }),
  })
}

export function useConfirmBudget(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: string | number | bigint) => {
      const r = await fetch('/api/call/confirm_budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), budgetId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to confirm budget')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', organizationId.toString()] }),
  })
}

export function useCancelBudget(organizationId: bigint, _companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (budgetId: string | number | bigint) => {
      const r = await fetch('/api/call/cancel_budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), budgetId.toString()]),
      })
      if (!r.ok) throw new Error('Failed to cancel budget')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', organizationId.toString()] }),
  })
}

export function useCreatePayment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create payment')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function usePostPayment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paymentId: string | number | bigint) => {
      const r = await fetch('/api/call/post_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(paymentId)]),
      })
      if (!r.ok) throw new Error('Failed to post payment')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function useCancelPayment(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paymentId: string | number | bigint) => {
      const r = await fetch('/api/call/cancel_payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(paymentId)]),
      })
      if (!r.ok) throw new Error('Failed to cancel payment')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function useRegisterPaymentOnInvoice(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      paymentId: string | number | bigint
      invoiceIds: Array<string | number | bigint>
      isBill: boolean
    }) => {
      const r = await fetch('/api/call/register_payment_on_invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(params.paymentId),
          params.invoiceIds.map((id) => Number(id)),
          params.isBill,
        ]),
      })
      if (!r.ok) throw new Error('Failed to register payment on invoice')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function useCreatePaymentTerm(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, Record<string, unknown>>({
    mutationFn: async (params) => {
      const r = await fetch('/api/call/create_payment_term', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), params]),
      })
      if (!r.ok) throw new Error('Failed to create payment term')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function useUpdatePaymentTerm(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      termId: string | number | bigint
      name?: string | null
      note?: string | null
      isActive?: boolean | null
    }) => {
      const r = await fetch('/api/call/update_payment_term', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          organizationId.toString(),
          Number(params.termId),
          params.name ?? null,
          params.note ?? null,
          params.isActive ?? null,
        ]),
      })
      if (!r.ok) throw new Error('Failed to update payment term')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

export function useDeletePaymentTerm(organizationId: bigint) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (termId: string | number | bigint) => {
      const r = await fetch('/api/call/delete_payment_term', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), Number(termId)]),
      })
      if (!r.ok) throw new Error('Failed to delete payment term')
    },
    onSuccess: () => invalidateAccountingQueries(qc, organizationId),
  })
}

// ── Types (re-exported so client components import from one place) ────────────
export type {
  AccountMove, CreateAccountAccountParams, CreateAccountMoveParams, CreateAccountTaxParams,
  CreateCrossoveredBudgetParams
} from '@lumiere/stdb'
