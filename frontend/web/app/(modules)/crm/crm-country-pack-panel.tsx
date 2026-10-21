"use client"

import { useTranslation } from "@lumiere/i18n"
import {
  useCompanyCountryPacks,
  useCountryPackCatalog,
  useSetCompanyCountryPack,
} from "@lumiere/query-hooks/hooks/organization-company"
import { CountryPackReadinessPanel } from "@lumiere/ui"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

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
    <div data-testid="crm-country-packs">
      <CountryPackReadinessPanel
        definitions={catalog.data ?? []}
        activations={packs.data ?? []}
        isLoading={catalog.isLoading || packs.isLoading}
        isPending={setPack.isPending}
        title={t("crm.countryPacks.title", "Country packs")}
        description={t(
          "crm.countryPacks.description",
          "Enable locale packs so contact tax IDs and addresses validate for this company.",
        )}
        onEnabledChange={async (packKey, enabled) => {
          await setPack.mutateAsync({
            companyId,
            organizationId,
            packKey,
            enabled,
          })
        }}
      />
    </div>
  )
}
