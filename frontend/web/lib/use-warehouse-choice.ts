"use client"

import { useMemo } from "react"
import { useErpSession } from "@lumiere/erp-session"
import { useTranslation } from "@lumiere/i18n"
import { useWarehouses } from "@lumiere/query-hooks/hooks/inventory"
import { moduleQueryState } from "@lumiere/ui/lib/module-data-state"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { companyWarehouseOptions, warehouseSetupAccess, warehouseSetupHref } from "./warehouse-choice"

export function useWarehouseChoice(organizationId: bigint, companyId: bigint) {
  const { t } = useTranslation()
  const { activeCompanyReady } = useErpSession()
  const { checkPermission, permissionsReady } = useRBAC()
  const canRead = checkPermission("warehouse", "read").allowed
  const companyReady = activeCompanyReady !== false && companyId > 0n
  const query = useWarehouses(organizationId, undefined, companyReady && permissionsReady !== false && canRead, companyId)
  const queryStatus = moduleQueryState(query).status
  const maySetUp = warehouseSetupAccess(checkPermission).warehouse
  const status =
    permissionsReady === false || activeCompanyReady === false ? "loading" :
      !canRead ? "denied" :
        !companyReady ? "company" : queryStatus === "partial" ? "error" : queryStatus
  const lookup = useMemo(() => {
    const scopedChoices = status === "ready" ? companyWarehouseOptions(query.data ?? [], organizationId, companyId) : []
    const choices = scopedChoices ?? []
    const displayStatus = scopedChoices == null ? "error" :
      status === "ready" && choices.length === 0 && query.isFetching ? "loading" : status
    const messages = {
      loading: t("inventory.warehouseSetup.choiceLoading"),
      denied: t("inventory.warehouseSetup.choiceDenied"),
      error: t("inventory.warehouseSetup.choiceFailed"),
      company: t("inventory.warehouseSetup.company-required"),
      ready: t(maySetUp ? "inventory.warehouseSetup.choiceEmptyManager" : "inventory.warehouseSetup.choiceEmptyOperator"),
    }
    const help = {
      ready: true,
      message: messages[displayStatus],
      retry: displayStatus === "error" ? {
        label: t("common.retry"),
        onRetry: () => { void query.refetch() },
      } : undefined,
      action: displayStatus === "ready" && maySetUp ? {
        href: warehouseSetupHref(companyId),
        label: t("inventory.warehouseSetup.title"),
      } : undefined,
    }
    return {
      options: choices,
      help,
      status: displayStatus === "company" ? "error" as const : displayStatus,
    }
  }, [companyId, maySetUp, organizationId, query.data, query.isFetching, query.refetch, status, t])
  return lookup
}
