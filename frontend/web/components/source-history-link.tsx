"use client"

import Link from "next/link"
import { useErpSession } from "@lumiere/erp-session"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { useTranslation } from "@lumiere/i18n"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { sourceHistoryLink } from "../lib/source-observation"

/** Discovery only; source-history reads retain their stricter server authority checks. */
export function SourceHistoryLink({ organizationId }: { organizationId: number }) {
  const companyId = useOperatingCompanyId(organizationId)
  const session = useErpSession()
  const { isAdmin, permissionsReady } = useRBAC()
  const { t } = useTranslation()
  if (
    !permissionsReady || !isAdmin() || !session.activeCompanyReady
    || session.organizationId !== organizationId || !companyId
  ) return null
  return (
    <div className="flex justify-end px-4 pt-3">
      <Link className="text-sm font-medium underline underline-offset-4" href={sourceHistoryLink(companyId)}>
        {t("availableHistory.openVerified", { defaultValue: "Historical source facts" })}
      </Link>
    </div>
  )
}
