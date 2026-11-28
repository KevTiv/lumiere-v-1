"use client"

import type { ReactNode } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { DashboardHeader } from "@lumiere/ui"
import { Button } from "@lumiere/ui/components/button"
import { useFarmOperationsAvailability } from "@/lib/use-farm-operations-enabled"
import { FarmOperationsSetting } from "@/lib/farm-operations-setting"

export function FarmOperationsGate({
  organizationId,
  expectedCompany,
  children,
}: {
  organizationId?: number
  expectedCompany?: string | null
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { identity } = useErpSession()
  const companyId = useOperatingCompanyId(organizationId)
  const companies = useCompanies(organizationId ?? 0, !!identity)
  const { status, packs } = useFarmOperationsAvailability(companyId)
  const companyName = companies.data?.find((company) => String(company.id) === String(companyId))?.name
    || t("farmOperations.companyFallback", { id: companyId })
  const wrongCompany = companyId !== null && expectedCompany != null && expectedCompany !== String(companyId)

  if (status === "enabled" && !wrongCompany) return children

  return (
    <div className="min-w-0 space-y-5">
      <DashboardHeader title={t("nav.farmBatches")} />
      <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        {status === "loading" ? <p role="status">{t("farmOperations.checking")}</p>
          : status === "no-company" ? <p role="status">{t("farmOperations.selectCompany")}</p>
          : wrongCompany ? <p role="status">{t("farmOperations.switchCompany")}</p>
          : status === "denied" ? <p role="status">{t("farmOperations.denied")}</p>
          : status === "unavailable" ? (
            <>
              <p role="alert">{t("farmOperations.unavailable")}</p>
              <Button type="button" variant="outline" size="sm" disabled={packs.isFetching} onClick={() => void packs.refetch()}>
                {t("farmOperations.recheck")}
              </Button>
            </>
          ) : status === "setup" && organizationId && companyId ? (
            <FarmOperationsSetting
              key={`${identity}:${organizationId}:${companyId}`}
              companyId={BigInt(companyId)}
              companyName={companyName}
              organizationId={organizationId}
              enableOnly
            />
          ) : <p role="status">{t("farmOperations.askAdmin", { company: companyName })}</p>}
      </div>
    </div>
  )
}
