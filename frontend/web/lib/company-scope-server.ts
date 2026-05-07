/** Validate ERP `company_id` belongs to the signed-in user's organization. */
import 'server-only'

import { serverQueryCompanies } from '@lumiere/stdb/server'

import type { ApiSession } from '@/lib/api-session'

export async function companyIdBelongsToOrganization(
  session: ApiSession,
  companyId: number,
): Promise<boolean> {
  const org = session.organizationId
  if (org === undefined || org <= 0 || companyId <= 0) return false
  try {
    const rows = await serverQueryCompanies(org, {
      token: session.stdbToken,
      fieldAccess: session.fieldAccess,
    })
    for (const r of rows as Record<string, unknown>[]) {
      if (Number(r.id) === companyId) return true
    }
    return false
  } catch {
    return false
  }
}
