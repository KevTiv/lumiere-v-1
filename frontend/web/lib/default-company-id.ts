/**
 * Temporary bridge for `/api/call` reducers not yet migrated to in-module company resolution.
 * Prefer passing `company_id` on reducer params from the client when known.
 */
import { stdbSql, type StdbHttpOptions } from '@lumiere/stdb/server'

export async function fetchDefaultCompanyId(
  organizationId: bigint | number,
  opts?: StdbHttpOptions,
): Promise<number | undefined> {
  const rows = await stdbSql<{ id: number }>(
    `SELECT id FROM company WHERE organization_id = ${organizationId} LIMIT 1`,
    opts,
  )
  const id = rows[0]?.id
  return id != null ? Number(id) : undefined
}
