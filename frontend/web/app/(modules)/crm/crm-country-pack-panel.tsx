"use client"

import { useMemo } from "react"

import { useTranslation } from "@lumiere/i18n"
import {
  useCompanyCountryPacks,
  useCountryPackCatalog,
  useSetCompanyCountryPack,
} from "@lumiere/query-hooks/hooks/organization-company"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"

export interface CrmCountryPackPanelProps {
  organizationId: number
  companyId: bigint
}

export function CrmCountryPackPanel({
  organizationId,
  companyId,
}: CrmCountryPackPanelProps) {
  const { t } = useTranslation()
  const catalog = useCountryPackCatalog(companyId > 0n)
  const packs = useCompanyCountryPacks(companyId, companyId > 0n)
  const setPack = useSetCompanyCountryPack()

  const enabledByKey = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const row of packs.data ?? []) {
      const key = String(row.packKey ?? "").toLowerCase()
      if (key) map.set(key, Boolean(row.enabled))
    }
    return map
  }, [packs.data])

  if (!companyId || companyId === 0n) {
    return (
      <Card data-testid="crm-country-packs">
        <CardHeader>
          <CardTitle>{t("crm.countryPacks.title", "Country packs")}</CardTitle>
          <CardDescription>
            {t(
              "crm.countryPacks.needCompany",
              "Select an operating company to enable party-data validators (ABN, CNPJ, …).",
            )}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card data-testid="crm-country-packs">
      <CardHeader>
        <CardTitle>{t("crm.countryPacks.title", "Country packs")}</CardTitle>
        <CardDescription>
          {t(
            "crm.countryPacks.description",
            "Enable locale packs so contact tax IDs and addresses validate for this company.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {catalog.isLoading || packs.isLoading ? (
          <p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
        ) : (catalog.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("crm.countryPacks.empty", "No country packs available.")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {(catalog.data ?? []).map((pack) => {
              const packKey = String(pack.packKey ?? "").toLowerCase()
              const countryCode = String(pack.countryCode ?? "")
              const enabled = enabledByKey.get(packKey) ?? false
              return (
                <li
                  key={packKey}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{pack.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {countryCode}
                      {pack.region ? ` · ${pack.region}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={enabled ? "default" : "secondary"}>
                      {enabled
                        ? t("crm.countryPacks.enabled", "On")
                        : t("crm.countryPacks.disabled", "Off")}
                    </Badge>
                    <Switch
                      checked={enabled}
                      disabled={setPack.isPending}
                      onCheckedChange={(checked) => {
                        void setPack.mutateAsync({
                          companyId,
                          organizationId,
                          packKey,
                          enabled: checked,
                        })
                      }}
                      aria-label={pack.name}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
