"use client"

import { useMemo } from "react"

import { useTranslation } from "@lumiere/i18n"
import type {
  CompanyCountryPackRow,
  CountryPackDefinitionRow,
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

import {
  countryPackReadiness,
  type CountryPackActivationBlock,
} from "./country-pack-readiness"

export interface CountryPackReadinessPanelProps {
  definitions: CountryPackDefinitionRow[]
  activations: CompanyCountryPackRow[]
  companyCountryCode?: string | null
  isLoading?: boolean
  isPending?: boolean
  now?: Date
  title?: string
  description?: string
  onEnabledChange: (packKey: string, enabled: boolean) => void | Promise<void>
}

function effectiveDateLabel(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "—"
}

function blockLabel(
  block: CountryPackActivationBlock,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (block) {
    case "review_required":
      return t("settings.organization.countryPacks.blocked.reviewRequired")
    case "inactive":
      return t("settings.organization.countryPacks.blocked.inactive")
    case "not_yet_effective":
      return t("settings.organization.countryPacks.blocked.notYetEffective")
    case "expired":
      return t("settings.organization.countryPacks.blocked.expired")
    case "invalid_effective_window":
      return t(
        "settings.organization.countryPacks.blocked.invalidEffectiveWindow",
      )
    case "version_mismatch":
      return t("settings.organization.countryPacks.blocked.versionMismatch")
    case "not_accepted":
      return t("settings.organization.countryPacks.blocked.notAccepted")
  }
}

export function CountryPackReadinessPanel({
  definitions,
  activations,
  companyCountryCode,
  isLoading = false,
  isPending = false,
  now,
  title,
  description,
  onEnabledChange,
}: CountryPackReadinessPanelProps) {
  const { t } = useTranslation()
  const rows = useMemo(
    () => countryPackReadiness(definitions, activations, now),
    [activations, definitions, now],
  )
  const normalizedCompanyCountry =
    companyCountryCode?.trim().toUpperCase() ?? ""

  return (
    <Card data-testid="country-pack-readiness-panel">
      <CardHeader>
        <CardTitle>
          {title ?? t("settings.organization.countryPacks.cardTitle")}
        </CardTitle>
        <CardDescription>
          {description ??
            t("settings.organization.countryPacks.cardDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-2xl space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.organization.countryPacks.emptyCatalog")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((pack) => {
              const countryMismatch = Boolean(
                normalizedCompanyCountry &&
                pack.countryCode &&
                normalizedCompanyCountry !== pack.countryCode,
              )
              const activationDisabled =
                isPending || (!pack.enabled && !pack.canActivate)
              return (
                <li key={pack.packKey} className="space-y-3 px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{pack.name}</p>
                        <Badge
                          variant={
                            pack.acceptanceStatus === "accepted"
                              ? "success"
                              : "secondary"
                          }
                        >
                          {t(
                            `settings.organization.countryPacks.acceptance.${pack.acceptanceStatus}`,
                            {
                              defaultValue: pack.acceptanceStatus,
                            },
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {pack.countryCode}
                        {pack.region
                          ? ` · ${t("settings.organization.countryPacks.regionLabel", { region: pack.region })}`
                          : ""}
                        {` · ${t("settings.organization.countryPacks.versionLabel", { version: pack.version })}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "settings.organization.countryPacks.effectiveWindow",
                          {
                            from: effectiveDateLabel(pack.effectiveFrom),
                            to: effectiveDateLabel(pack.effectiveTo),
                          },
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pack.pinnedPackVersion
                          ? t(
                              "settings.organization.countryPacks.pinnedVersion",
                              {
                                version: pack.pinnedPackVersion,
                              },
                            )
                          : t("settings.organization.countryPacks.notPinned")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={pack.enabled ? "default" : "secondary"}>
                        {pack.enabled
                          ? t("settings.organization.countryPacks.enabled")
                          : t("settings.organization.countryPacks.disabled")}
                      </Badge>
                      <Switch
                        checked={pack.enabled}
                        disabled={activationDisabled}
                        onCheckedChange={(checked) => {
                          if (checked && !pack.canActivate) return
                          void onEnabledChange(pack.packKey, checked)
                        }}
                        aria-label={t(
                          "settings.organization.countryPacks.toggleLabel",
                          {
                            pack: pack.name,
                          },
                        )}
                      />
                    </div>
                  </div>
                  {pack.activationBlock ? (
                    <p
                      className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                      data-testid={`country-pack-block-${pack.packKey}`}
                    >
                      {blockLabel(pack.activationBlock, t)}
                    </p>
                  ) : null}
                  {pack.complianceEvidence.officialSources.length > 0 ? (
                    <div
                      className="space-y-2 rounded-md border px-3 py-2 text-xs"
                      data-testid={`country-pack-evidence-${pack.packKey}`}
                    >
                      <p className="font-medium">
                        {t(
                          "settings.organization.countryPacks.evidenceSummary",
                          {
                            date: pack.complianceEvidence.lastReviewedOn ?? "—",
                            count:
                              pack.complianceEvidence.officialSources.length,
                          },
                        )}
                      </p>
                      <ul className="space-y-1 text-muted-foreground">
                        {pack.complianceEvidence.officialSources.map(
                          (source) => (
                            <li key={`${source.url}:${source.accessedOn}`}>
                              <a
                                className="underline underline-offset-2"
                                href={source.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {source.authority}: {source.title}
                              </a>
                            </li>
                          ),
                        )}
                      </ul>
                      {pack.complianceEvidence.confirmationRequired.length >
                      0 ? (
                        <p className="text-amber-700 dark:text-amber-300">
                          {t(
                            "settings.organization.countryPacks.decisionsRemaining",
                            {
                              count:
                                pack.complianceEvidence.confirmationRequired
                                  .length,
                            },
                          )}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {countryMismatch ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {t("settings.organization.countryPacks.countryMismatch", {
                        companyCountry: normalizedCompanyCountry,
                        packCountry: pack.countryCode,
                      })}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
