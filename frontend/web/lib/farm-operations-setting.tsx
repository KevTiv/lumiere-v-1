"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useCompanyVerticalPacks, useSetCompanyVerticalPack } from "@lumiere/query-hooks/hooks/organization-company"
import { Button } from "@lumiere/ui/components/button"
import { useRBAC } from "@lumiere/ui/lib/rbac-context"
import { farmOperationsPackKey, findFarmOperationsPack, updateFarmOperationsSetting } from "./farm-operations-access"

export function FarmOperationsSetting({
  companyId,
  companyName,
  organizationId,
  enableOnly = false,
}: {
  companyId: bigint
  companyName: string
  organizationId: number
  enableOnly?: boolean
}) {
  const { t } = useTranslation()
  const { permissionsReady, checkPermission } = useRBAC()
  const canChange = permissionsReady === true && checkPermission("company", "write").allowed
  const packs = useCompanyVerticalPacks(companyId, canChange)
  const setPack = useSetCompanyVerticalPack()
  const [updateState, setUpdateState] = useState<"idle" | "saving" | "save-error" | "unverified">("idle")
  const pack = findFarmOperationsPack(packs.data, String(companyId))
  const enabled = pack?.enabled === true

  async function toggle() {
    if (!canChange || packs.isError || !packs.data || packs.isFetching || updateState === "saving" || (enableOnly && enabled)) return
    const desired = !enabled
    setUpdateState("saving")
    const result = await updateFarmOperationsSetting({
      companyId: String(companyId),
      enabled: desired,
      save: () => setPack.mutateAsync({
        companyId,
        organizationId,
        packKey: farmOperationsPackKey,
        enabled: desired,
        configuration: pack?.configuration ?? undefined,
      }),
      read: () => packs.refetch(),
    })
    setUpdateState(result === "verified" ? "idle" : result)
  }

  if (!canChange) return null
  return (
    <section className={enableOnly ? "space-y-3" : "space-y-3 border-t pt-4"} aria-label={t("farmOperations.settingTitle")}>
      {!enableOnly && <h3 className="text-sm font-semibold">{t("farmOperations.settingTitle")}</h3>}
      <p role="status" className="text-sm text-muted-foreground">
        {updateState === "saving"
          ? t("farmOperations.saving")
          : packs.isPending
            ? t("farmOperations.checking")
            : packs.isError
              ? t("farmOperations.unavailable")
              : t(enabled ? "farmOperations.enabled" : "farmOperations.disabled", { company: companyName })}
      </p>
      {packs.data && !packs.isError && !enabled && <p className="text-sm text-muted-foreground">{t("farmOperations.enableDescription")}</p>}
      {updateState === "save-error" && <p role="alert" className="text-sm text-destructive">{t("farmOperations.saveError")}</p>}
      {updateState === "unverified" && <p role="alert" className="text-sm text-destructive">{t("farmOperations.unverified")}</p>}
      {packs.isError || updateState === "unverified" ? (
        <Button type="button" variant="outline" size="sm" disabled={packs.isFetching} onClick={async () => {
          const readback = await packs.refetch()
          if (!readback.error) setUpdateState("idle")
        }}>
          {t("farmOperations.recheck")}
        </Button>
      ) : !enableOnly || !enabled ? (
        <Button
          type="button"
          variant={enableOnly ? "default" : "outline"}
          size="sm"
          disabled={!packs.data || packs.isFetching || updateState === "saving"}
          onClick={() => void toggle()}
        >
          {t(enabled ? "farmOperations.disableAction" : "farmOperations.enableAction")}
        </Button>
      ) : null}
    </section>
  )
}
