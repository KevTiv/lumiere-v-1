/** Validate ERP `company_id` belongs to the signed-in user's organization. */
import "server-only"

import type { ApiSession } from "@/lib/api-session"
import { serverFetchQueryListAllowEmpty } from "@/lib/server-query"

export async function companyIdBelongsToOrganization(
  session: ApiSession,
  companyId: number,
): Promise<boolean> {
  const org = session.organizationId
  if (org === undefined || org <= 0 || companyId <= 0) return false
  try {
    const rows = await serverFetchQueryListAllowEmpty(session, "companies")
    for (const r of rows) {
      if (Number(r.id) === companyId) return true
    }
    return false
  } catch {
    return false
  }
}
