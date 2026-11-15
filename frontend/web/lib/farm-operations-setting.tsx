"use client"

import { useState } from "react"
import { useCompanyVerticalPacks, useSetCompanyVerticalPack } from "@lumiere/query-hooks/hooks/organization-company"
import { Button } from "@lumiere/ui/components/button"

export function FarmOperationsSetting({
  companyId,
  companyName,
  organizationId,
}: {
  companyId: bigint
  companyName: string
  organizationId: number
}) {
  const packs = useCompanyVerticalPacks(companyId)
  const setPack = useSetCompanyVerticalPack()
  const [saveError, setSaveError] = useState("")
  const pack = packs.data?.find((row) =>
    String(row.companyId) === String(companyId) && row.packKey === "farm_operations",
  )
  const enabled = pack?.enabled === true

  const toggle = async () => {
    setSaveError("")
    const desired = !enabled
    try {
      await setPack.mutateAsync({
        companyId,
        organizationId,
        packKey: "farm_operations",
        enabled: desired,
        configuration: pack?.configuration ?? undefined,
      })
      const readback = await packs.refetch()
      if (readback.error || !readback.data?.some((row) =>
        String(row.companyId) === String(companyId) && row.packKey === "farm_operations" && row.enabled === desired,
      )) {
        setSaveError("The saved Farm Batches setting could not be verified. Refresh before trying again.")
      }
    } catch {
      setSaveError("Farm Batches could not be updated for this company. Check your access and try again.")
    }
  }

  return (
    <section className="space-y-2 border-t pt-4" aria-label="Farm Batches settings">
      <h3 className="text-sm font-semibold">Farm Batches</h3>
      <p className="text-sm text-muted-foreground">
        {packs.isPending
          ? "Checking company access…"
          : packs.isError
            ? "The current setting could not be read."
            : `${enabled ? "Enabled" : "Disabled"} for ${companyName}.`}
      </p>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {packs.isError ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void packs.refetch()}>
          Retry
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={packs.isPending || packs.isFetching || setPack.isPending}
          onClick={() => void toggle()}
        >
          {enabled ? "Disable Farm Batches" : "Enable Farm Batches"}
        </Button>
      )}
    </section>
  )
}
