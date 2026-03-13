/**
 * Server-side query functions for TanStack Start SSR.
 *
 * These call SpacetimeDB's HTTP SQL API and return plain JSON objects
 * (u64s as numbers, not bigints — safe for JSON serialization/dehydration).
 *
 * Import from "@lumiere/stdb/server" in route loaders only.
 * Never import in client-side components — use the WebSocket hooks instead.
 *
 * Usage in a TanStack Start route loader:
 *   import { serverQueryAccountAccounts, accountAccountsKey } from "@lumiere/stdb/server"
 *
 *   loader: async ({ context: { queryClient } }) => {
 *     await queryClient.prefetchQuery({
 *       queryKey: accountAccountsKey(DEFAULT_COMPANY_ID),
 *       queryFn: () => serverQueryAccountAccounts(DEFAULT_COMPANY_ID),
 *     })
 *   }
 */

import { stdbSql, type StdbHttpOptions } from './http'

// ── Query key helpers (must match the keys used in client hooks) ─────────────

export const accountAccountsKey = (companyId: bigint | number) =>
  ['account-accounts', String(companyId)] as const

export const accountJournalsKey = (companyId: bigint | number) =>
  ['account-journals', String(companyId)] as const

export const accountMovesKey = (companyId: bigint | number) =>
  ['account-moves', String(companyId)] as const

export const accountTaxesKey = (companyId: bigint | number) =>
  ['account-taxes', String(companyId)] as const

export const budgetsKey = (companyId: bigint | number) =>
  ['budgets', String(companyId)] as const

// ── Server query functions ───────────────────────────────────────────────────

export function serverQueryAccountAccounts(
  companyId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM account_account WHERE company_id = ${companyId} ORDER BY code`,
    opts,
  )
}

export function serverQueryAccountJournals(
  companyId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM account_journal WHERE company_id = ${companyId}`,
    opts,
  )
}

export function serverQueryAccountMoves(
  companyId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM account_move WHERE company_id = ${companyId}`,
    opts,
  )
}

export function serverQueryAccountTaxes(
  companyId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM account_tax WHERE company_id = ${companyId}`,
    opts,
  )
}

export function serverQueryBudgets(
  companyId: bigint | number,
  opts?: StdbHttpOptions,
) {
  return stdbSql(
    `SELECT * FROM crossovered_budget WHERE company_id = ${companyId}`,
    opts,
  )
}
