"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Building, Save, Loader2, Cloud, MessageCircle, ExternalLink, Upload, Trash2 } from "lucide-react"
import { useUpdateGoogleDriveCredentials, useUpdateWhatsappCredentials } from "@lumiere/query-hooks/hooks/auth"
import { useOrgMasterCsvImportMutations } from "@lumiere/query-hooks/hooks/org-master-csv-imports"
import {
  useCompanies,
  useCreateCompany,
  useCreateDataClassification,
  useCreateDataClassificationRule,
  useDataClassificationRules,
  useDataClassifications,
  useDeleteCompany,
  useUpdateCompany,
  useUpdateCompanyAddress,
  useUpdateCompanyBusiness,
  useUpdateCompanyHierarchy,
} from "@lumiere/query-hooks/hooks/organization-company"
import { useUpdateOrganization, useUpsertOrganizationSettings, useCreateCountry, useCreateCurrency } from "@lumiere/query-hooks/hooks/settings"
import { useErpSession } from "@lumiere/erp-session"
import { csvImportForm, FormModal } from "@lumiere/ui"
import { hasValidOrganizationId } from "@/lib/org-scoped"
import { ModularForm } from "../forms/modular-form"
import { mergeFieldDefaultValues, mergeSelectOptionsByFieldName } from "../lib/form-config-merge"
import {
  organizationCompanyAddressForm,
  organizationCompanyBusinessForm,
  organizationCompanyCreateForm,
  organizationCompanyHierarchyForm,
  organizationCompanyLegalNameForm,
  organizationCompanyPickerForm,
  organizationPrivacyClassificationForm,
  organizationPrivacyRuleForm,
  withCompanyIdField,
} from "../lib/organization-company-form-configs"
import { createCountryForm, createCurrencyForm } from "../lib/settings-platform-form-configs"
import { useRBAC } from "@/lib/rbac-context"
import { cn } from "@/lib/utils"

type OrgMasterCsvKind =
  | "country"
  | "currency"
  | "currencyRate"
  | "company"
  | "role"
  | "aiAgent"

function strVal(v: unknown): string {
  return v == null ? "" : String(v)
}

function companyIdFromForm(data: Record<string, unknown>): string {
  return String(data.companyId ?? "").trim()
}

/**
 * Organization Settings Component
 *
 * Manages organization-level settings via the upsert_organization_settings reducer.
 * This connects to SpacetimeDB for persistent organization configuration.
 */
export function OrganizationSettings() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const { organizationId } = useErpSession()
  const [csvKind, setCsvKind] = useState<OrgMasterCsvKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [referenceModal, setReferenceModal] = useState<"country" | "currency" | null>(null)
  const [referenceError, setReferenceError] = useState<string | null>(null)

  const orgReady = hasValidOrganizationId(organizationId)
  const orgId = orgReady ? organizationId : 0
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const csvImports = useOrgMasterCsvImportMutations(orgId)

  const { data: companies = [], isLoading: companiesLoading } = useCompanies(orgId, orgReady)
  const { data: dataClassifications = [] } = useDataClassifications(orgId, orgReady)
  const { data: dataClassificationRules = [] } = useDataClassificationRules(orgId, orgReady)

  const createCompany = useCreateCompany(orgId)
  const updateCompany = useUpdateCompany()
  const updateCompanyAddress = useUpdateCompanyAddress()
  const updateCompanyBusiness = useUpdateCompanyBusiness()
  const updateCompanyHierarchy = useUpdateCompanyHierarchy()
  const deleteCompany = useDeleteCompany()
  const createDataClassification = useCreateDataClassification(orgId)
  const createDataClassificationRule = useCreateDataClassificationRule(orgId)
  const upsertOrganizationSettings = useUpsertOrganizationSettings(orgBigInt)
  const updateOrganization = useUpdateOrganization(orgBigInt)
  const createCountry = useCreateCountry()
  const createCurrency = useCreateCurrency()
  const { checkPermission, isAdmin } = useRBAC()

  const [selectedCompanyId, setSelectedCompanyId] = useState("")
  const [privacyDcFormKey, setPrivacyDcFormKey] = useState(0)
  const [privacyRuleFormKey, setPrivacyRuleFormKey] = useState(0)

  const selectedCompany = useMemo(
    () => companies.find((x) => String(x.id) === selectedCompanyId),
    [companies, selectedCompanyId],
  )

  const legalNameDefaults = useMemo(
    () => ({ name: strVal(selectedCompany?.name) }),
    [selectedCompany],
  )

  const addressDefaults = useMemo(
    () => ({
      addressStreet: strVal(selectedCompany?.addressStreet),
      addressCity: strVal(selectedCompany?.addressCity),
      addressZip: strVal(selectedCompany?.addressZip),
      addressCountryCode: strVal(selectedCompany?.addressCountryCode),
    }),
    [selectedCompany],
  )

  const businessDefaults = useMemo(
    () => ({
      taxId: strVal(selectedCompany?.taxId),
      companyRegistry: strVal(selectedCompany?.companyRegistry),
    }),
    [selectedCompany],
  )

  const hierarchyDefaults = useMemo(
    () => ({
      isParent: Boolean(selectedCompany?.isParent),
      parentId:
        selectedCompany?.parentId != null ? String(selectedCompany.parentId) : "__none__",
    }),
    [selectedCompany],
  )

  const companyPickerFormConfig = useMemo(() => {
    const opts = companies.map((c) => ({
      value: String(c.id),
      label: `${strVal(c.name)} (${strVal(c.code)})`,
    }))
    const base = mergeSelectOptionsByFieldName(organizationCompanyPickerForm(t), "companyId", opts)
    return mergeFieldDefaultValues(base, {
      companyId: selectedCompanyId || opts[0]?.value || "",
    })
  }, [t, companies, selectedCompanyId])

  const legalNameFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(withCompanyIdField(organizationCompanyLegalNameForm(t)), {
        ...legalNameDefaults,
        companyId: selectedCompanyId,
      }),
    [t, legalNameDefaults, selectedCompanyId],
  )

  const hierarchyFormConfig = useMemo(() => {
    const base = withCompanyIdField(organizationCompanyHierarchyForm(t))
    const withOpts = mergeSelectOptionsByFieldName(base, "parentId", [
      { value: "__none__", label: t("settings.organization.company.noParent") },
      ...companies
        .filter((co) => String(co.id) !== selectedCompanyId)
        .map((co) => ({ value: String(co.id), label: strVal(co.name) })),
    ])
    return mergeFieldDefaultValues(withOpts, {
      ...hierarchyDefaults,
      companyId: selectedCompanyId,
    })
  }, [t, companies, selectedCompanyId, hierarchyDefaults])

  const createCompanyFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(withCompanyIdField(organizationCompanyCreateForm(t)), {
        companyId: selectedCompanyId,
      }),
    [t, selectedCompanyId],
  )

  const companyAddressFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(withCompanyIdField(organizationCompanyAddressForm(t)), {
        ...addressDefaults,
        companyId: selectedCompanyId,
      }),
    [t, addressDefaults, selectedCompanyId],
  )

  const companyBusinessFormConfig = useMemo(
    () =>
      mergeFieldDefaultValues(withCompanyIdField(organizationCompanyBusinessForm(t)), {
        ...businessDefaults,
        companyId: selectedCompanyId,
      }),
    [t, businessDefaults, selectedCompanyId],
  )

  const privacyDcFormConfig = useMemo(
    () => ({
      ...mergeFieldDefaultValues(organizationPrivacyClassificationForm(t), {
        name: "",
        level: "2",
        description: "",
        retentionDays: "",
        encryptionRequired: false,
      }),
      submitLabel: t("settings.organization.privacy.classificationTitle"),
    }),
    [t],
  )

  const privacyRuleFormConfig = useMemo(() => {
    const base = organizationPrivacyRuleForm(t)
    const opts = dataClassifications.map((row) => ({
      value: String(row.id),
      label: `${strVal(row.name)} (${t("settings.organization.privacy.ruleLevel", { level: strVal(row.level) })})`,
    }))
    const withOpts = mergeSelectOptionsByFieldName(base, "classificationId", opts)
    return {
      ...mergeFieldDefaultValues(withOpts, {
        tableName: "",
        columnName: "",
        classificationId: "",
        appliesTo: "all",
      }),
      submitLabel: t("settings.organization.privacy.ruleTitle"),
    }
  }, [t, dataClassifications])

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

  useEffect(() => {
    if (!companies.length) {
      setSelectedCompanyId("")
      return
    }
    const idSet = new Set(companies.map((c) => String(c.id)))
    if (selectedCompanyId && idSet.has(selectedCompanyId)) return
    const sorted = [...companies].sort(
      (a, b) => Number(b.isParent) - Number(a.isParent) || Number(a.id) - Number(b.id),
    )
    setSelectedCompanyId(String(sorted[0].id))
  }, [companies, selectedCompanyId])

  useEffect(() => {
    const c = companies.find((x) => String(x.id) === selectedCompanyId)
    if (!c) return
    setSettings((s) => ({
      ...s,
      address: {
        street: strVal(c.addressStreet),
        city: strVal(c.addressCity),
        state: s.address.state,
        zip: strVal(c.addressZip),
        country: strVal(c.addressCountryCode),
      },
      taxId: strVal(c.taxId),
      registrationNumber: strVal(c.companyRegistry),
    }))
  }, [selectedCompanyId, companies])

  const csvFormConfig = useMemo(() => {
    if (!csvKind) return null
    const titleKey: Record<OrgMasterCsvKind, string> = {
      country: "settings.organization.csvImport.countriesTitle",
      currency: "settings.organization.csvImport.currenciesTitle",
      currencyRate: "settings.organization.csvImport.currencyRatesTitle",
      company: "settings.organization.csvImport.companiesTitle",
      role: "settings.organization.csvImport.rolesTitle",
      aiAgent: "settings.organization.csvImport.aiAgentsTitle",
    }
    return csvImportForm(t, t(titleKey[csvKind]))
  }, [csvKind, t])

  const countryFormConfig = useMemo(() => createCountryForm(t), [t])
  const currencyFormConfig = useMemo(() => createCurrencyForm(t), [t])
  const canManageReference = isAdmin() || checkPermission("admin:organization", "manage").allowed

  // Integration hooks
  const updateGoogleDriveCredentials = useUpdateGoogleDriveCredentials(orgBigInt)
  const updateWhatsappCredentials = useUpdateWhatsappCredentials(orgBigInt)

  const [settings, setSettings] = useState({
    name: "",
    description: "",
    defaultCurrency: "USD",
    timezone: "UTC",
    fiscalYearEnd: "",
    taxId: "",
    registrationNumber: "",
    address: {
      street: "",
      city: "",
      state: "",
      zip: "",
      country: "",
    },
    contact: {
      email: "",
      phone: "",
      website: "",
    },
  })

  const handleSave = async () => {
    if (!orgReady) {
      toast({
        title: t("settings.organization.saveError"),
        description: t("settings.organization.saveErrorDescription"),
        variant: "destructive",
      })
      return
    }
    setIsLoading(true)
    try {
      await upsertOrganizationSettings.mutateAsync(settings)

      toast({
        title: t("settings.organization.saveSuccess"),
        description: t("settings.organization.saveSuccessDescription"),
      })
    } catch (error) {
      toast({
        title: t("settings.organization.saveError"),
        description: error instanceof Error ? error.message : t("settings.organization.saveErrorDescription"),
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateOrganization = async () => {
    if (!orgReady) {
      toast({
        title: t("settings.organization.updateError"),
        description: t("settings.organization.updateErrorDescription"),
        variant: "destructive",
      })
      return
    }
    setIsLoading(true)
    try {
      await updateOrganization.mutateAsync({
        name: settings.name,
        description: settings.description,
      })

      toast({
        title: t("settings.organization.updateSuccess"),
        description: t("settings.organization.updateSuccessDescription"),
      })
    } catch (error) {
      toast({
        title: t("settings.organization.updateError"),
        description: error instanceof Error ? error.message : t("settings.organization.updateErrorDescription"),
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-primary/10">
          <Building className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{t("settings.organization.title")}</h2>
          <p className="text-muted-foreground">{t("settings.organization.description")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.organization.generalInfo")}</CardTitle>
          <CardDescription>{t("settings.organization.generalInfoDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">{t("settings.organization.name")}</Label>
              <Input
                id="org-name"
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                placeholder={t("settings.organization.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-currency">{t("settings.organization.defaultCurrency")}</Label>
              <Input
                id="org-currency"
                value={settings.defaultCurrency}
                onChange={(e) => setSettings({ ...settings, defaultCurrency: e.target.value })}
                placeholder="USD"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-description">{t("settings.organization.description")}</Label>
            <Textarea
              id="org-description"
              value={settings.description}
              onChange={(e) => setSettings({ ...settings, description: e.target.value })}
              placeholder={t("settings.organization.descriptionPlaceholder")}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={handleUpdateOrganization} disabled={isLoading} variant="outline">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("common.saving")}
                </>
              ) : (
                t("settings.organization.updateOrg")
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {orgReady ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.organization.company.cardTitle")}</CardTitle>
            <CardDescription>{t("settings.organization.company.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {companiesLoading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("settings.organization.company.empty")}</p>
            ) : (
              <>
                <ModularForm
                  key={`company-picker-${selectedCompanyId}-${companies.map((c) => c.id).join(",")}`}
                  config={companyPickerFormConfig}
                  className="max-w-xl"
                  onValuesChange={(v) => {
                    const id = String(v.companyId ?? "").trim()
                    if (id) setSelectedCompanyId(id)
                  }}
                />
                <div
                  className={cn("max-w-xl", updateCompany.isPending && "pointer-events-none opacity-50")}
                >
                  <ModularForm
                    key={`co-legal-${selectedCompanyId}`}
                    config={legalNameFormConfig}
                    className="max-w-xl"
                    onSubmit={async (data) => {
                      const cid = companyIdFromForm(data)
                      if (!cid) return
                      const name = String(data.name ?? "").trim()
                      await updateCompany.mutateAsync({
                        companyId: BigInt(cid),
                        organizationId: orgId,
                        params: { name },
                      })
                      toast({ title: t("settings.organization.company.saveNameSuccess") })
                    }}
                  />
                </div>

                <div className="border-t pt-4 space-y-3">
                  <h4 className="text-sm font-medium">{t("settings.organization.company.hierarchyTitle")}</h4>
                  <div
                    className={cn(
                      "max-w-xl",
                      updateCompanyHierarchy.isPending && "pointer-events-none opacity-50",
                    )}
                  >
                    <ModularForm
                      key={`co-hier-${selectedCompanyId}`}
                      config={hierarchyFormConfig}
                      className="max-w-xl"
                      onSubmit={async (data) => {
                        const cid = companyIdFromForm(data)
                        if (!cid) return
                        const raw = String(data.parentId ?? "__none__")
                        const params: { isParent: boolean; parentId?: bigint } = {
                          isParent: Boolean(data.isParent),
                        }
                        if (raw !== "" && raw !== "__none__") {
                          params.parentId = BigInt(raw)
                        }
                        await updateCompanyHierarchy.mutateAsync({
                          companyId: BigInt(cid),
                          organizationId: orgId,
                          params,
                        })
                        toast({ title: t("settings.organization.company.saveHierarchySuccess") })
                      }}
                    />
                  </div>
                </div>

                <div className="border-t pt-4 space-y-3">
                  <h4 className="text-sm font-medium">{t("settings.organization.company.createTitle")}</h4>
                  <p className="text-sm text-muted-foreground">{t("settings.organization.company.createHint")}</p>
                  <div
                    className={cn("max-w-xl", createCompany.isPending && "pointer-events-none opacity-50")}
                  >
                    <ModularForm
                      key={`co-create-${selectedCompanyId}`}
                      config={createCompanyFormConfig}
                      className="max-w-xl"
                      onSubmit={async (data) => {
                        const cid = companyIdFromForm(data)
                        if (!cid) return
                        const row = companies.find((c) => String(c.id) === cid)
                        const cur = row?.currencyId != null ? BigInt(String(row.currencyId)) : 1n
                        const nm = String(data.name ?? "").trim()
                        if (!nm) return
                        const codeRaw = String(data.code ?? "").trim()
                        await createCompany.mutateAsync({
                          name: nm,
                          code: (codeRaw || nm.slice(0, 12)).toUpperCase(),
                          currencyId: cur,
                          fiscalYearEndMonth: 12,
                          fiscalYearEndDay: 31,
                          isParent: false,
                          parentId: BigInt(cid),
                          taxId: "",
                          companyRegistry: "",
                          addressStreet: "",
                          addressCity: "",
                          addressZip: "",
                          addressCountryCode: "",
                        })
                        toast({ title: t("settings.organization.company.createSuccess") })
                      }}
                    />
                  </div>
                </div>

                {companies.length > 1 ? (
                  <div className="border-t pt-4">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      disabled={deleteCompany.isPending || !selectedCompanyId}
                      onClick={() => {
                        if (!selectedCompanyId) return
                        if (!window.confirm(t("settings.organization.company.deleteConfirm"))) return
                        void deleteCompany
                          .mutateAsync({
                            companyId: BigInt(selectedCompanyId),
                            organizationId: orgId,
                          })
                          .then(() => toast({ title: t("settings.organization.company.deleteSuccess") }))
                          .catch((e) =>
                            toast({
                              title: t("settings.organization.company.saveError"),
                              description: e instanceof Error ? e.message : String(e),
                              variant: "destructive",
                            }),
                          )
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("settings.organization.company.deleteButton")}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.organization.address")}</CardTitle>
          <CardDescription>{t("settings.organization.company.addressDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {orgReady && selectedCompanyId ? (
            <div
              className={cn(
                "max-w-xl",
                updateCompanyAddress.isPending && "pointer-events-none opacity-50",
              )}
            >
              <ModularForm
                key={`co-addr-${selectedCompanyId}`}
                config={companyAddressFormConfig}
                className="max-w-xl"
                onSubmit={async (data) => {
                  const cid = companyIdFromForm(data)
                  if (!cid) return
                  const street = String(data.addressStreet ?? "").trim()
                  const city = String(data.addressCity ?? "").trim()
                  const zip = String(data.addressZip ?? "").trim()
                  const country = String(data.addressCountryCode ?? "").trim()
                  await updateCompanyAddress.mutateAsync({
                    companyId: BigInt(cid),
                    organizationId: orgId,
                    params: {
                      addressStreet: street,
                      addressCity: city,
                      addressZip: zip,
                      addressCountryCode: country,
                    },
                  })
                  setSettings((s) => ({
                    ...s,
                    address: {
                      ...s.address,
                      street,
                      city,
                      zip,
                      country,
                    },
                  }))
                  toast({ title: t("settings.organization.company.saveAddressSuccess") })
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {orgReady
                ? t("settings.organization.company.empty")
                : t("common.noOrganization.description")}
            </p>
          )}
          <div className="space-y-2 max-w-xl pt-2 border-t">
            <Label htmlFor="org-state">{t("settings.organization.state")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.organization.stateOrgOnlyHint")}</p>
            <Input
              id="org-state"
              value={settings.address.state}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  address: { ...settings.address, state: e.target.value },
                })
              }
              placeholder={t("settings.organization.statePlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

      {orgReady && selectedCompanyId ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.organization.company.businessTitle")}</CardTitle>
            <CardDescription>{t("settings.organization.company.businessDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-w-xl">
            <div className={cn(updateCompanyBusiness.isPending && "pointer-events-none opacity-50")}>
              <ModularForm
                key={`co-biz-${selectedCompanyId}`}
                config={companyBusinessFormConfig}
                className="max-w-xl"
                onSubmit={async (data) => {
                  const cid = companyIdFromForm(data)
                  if (!cid) return
                  const taxId = String(data.taxId ?? "").trim()
                  const companyRegistry = String(data.companyRegistry ?? "").trim()
                  await updateCompanyBusiness.mutateAsync({
                    companyId: BigInt(cid),
                    organizationId: orgId,
                    params: { taxId, companyRegistry },
                  })
                  setSettings((s) => ({
                    ...s,
                    taxId,
                    registrationNumber: companyRegistry,
                  }))
                  toast({ title: t("settings.organization.company.saveBusinessSuccess") })
                }}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {orgReady ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.organization.privacy.cardTitle")}</CardTitle>
            <CardDescription>{t("settings.organization.privacy.cardDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ModularForm
              key={`privacy-dc-${privacyDcFormKey}`}
              config={privacyDcFormConfig}
              className="max-w-xl"
              onSubmit={async (data) => {
                try {
                  const retentionRaw = data.retentionDays
                  const retentionDays =
                    retentionRaw === "" || retentionRaw == null || Number.isNaN(Number(retentionRaw))
                      ? undefined
                      : Number(retentionRaw)
                  await createDataClassification.mutateAsync({
                    name: String(data.name ?? "").trim(),
                    level: Number(data.level),
                    description: String(data.description ?? "").trim() || undefined,
                    retentionDays,
                    encryptionRequired: Boolean(data.encryptionRequired),
                  })
                  setPrivacyDcFormKey((k) => k + 1)
                  toast({ title: t("settings.organization.privacy.classificationSuccess") })
                } catch (e) {
                  toast({
                    title: t("settings.organization.company.saveError"),
                    description: e instanceof Error ? e.message : String(e),
                    variant: "destructive",
                  })
                }
              }}
            />
            {dataClassifications.length > 0 ? (
              <div className="text-sm space-y-1">
                <p className="font-medium">{t("settings.organization.privacy.classificationsHeading")}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {dataClassifications.map((row) => (
                    <li key={String(row.id)}>
                      {strVal(row.name)} (L{strVal(row.level)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("settings.organization.privacy.noClassifications")}
              </p>
            )}

            <div className="border-t pt-4 space-y-4">
              {dataClassifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.organization.privacy.noClassificationsForRules")}
                </p>
              ) : (
                <ModularForm
                  key={`privacy-rule-${privacyRuleFormKey}`}
                  config={privacyRuleFormConfig}
                  className="max-w-xl"
                  onSubmit={async (data) => {
                    try {
                      await createDataClassificationRule.mutateAsync({
                        tableName: String(data.tableName ?? "").trim(),
                        columnName: String(data.columnName ?? "").trim() || undefined,
                        classificationId: BigInt(String(data.classificationId)),
                        appliesTo: String(data.appliesTo ?? "all"),
                      })
                      setPrivacyRuleFormKey((k) => k + 1)
                      toast({ title: t("settings.organization.privacy.ruleSuccess") })
                    } catch (e) {
                      toast({
                        title: t("settings.organization.company.saveError"),
                        description: e instanceof Error ? e.message : String(e),
                        variant: "destructive",
                      })
                    }
                  }}
                />
              )}
            </div>
            {dataClassificationRules.length > 0 ? (
              <div className="text-sm space-y-1">
                <p className="font-medium">{t("settings.organization.privacy.rulesHeading")}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {dataClassificationRules.map((row) => {
                    const cls = dataClassifications.find((c) => String(c.id) === String(row.classificationId))
                    return (
                      <li key={String(row.id)}>
                        {strVal(row.tableName)}
                        {row.columnName != null && strVal(row.columnName) !== ""
                          ? `.${strVal(row.columnName)}`
                          : ""}{" "}
                        → {cls ? strVal(cls.name) : strVal(row.classificationId)}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.organization.privacy.noRules")}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.organization.contact")}</CardTitle>
          <CardDescription>{t("settings.organization.contactDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="org-email">{t("settings.organization.email")}</Label>
              <Input
                id="org-email"
                type="email"
                value={settings.contact.email}
                onChange={(e) => setSettings({
                  ...settings,
                  contact: { ...settings.contact, email: e.target.value }
                })}
                placeholder={t("settings.organization.emailPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-phone">{t("settings.organization.phone")}</Label>
              <Input
                id="org-phone"
                value={settings.contact.phone}
                onChange={(e) => setSettings({
                  ...settings,
                  contact: { ...settings.contact, phone: e.target.value }
                })}
                placeholder={t("settings.organization.phonePlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-website">{t("settings.organization.website")}</Label>
            <Input
              id="org-website"
              value={settings.contact.website}
              onChange={(e) => setSettings({
                ...settings,
                contact: { ...settings.contact, website: e.target.value }
              })}
              placeholder={t("settings.organization.websitePlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

      {hasValidOrganizationId(organizationId) ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>{t("settings.organization.csvImport.sectionTitle")}</CardTitle>
                <CardDescription>{t("settings.organization.csvImport.sectionDescription")}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("country")}>
              {t("settings.organization.csvImport.toolbarCountries")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("currency")}>
              {t("settings.organization.csvImport.toolbarCurrencies")}
            </Button>
            {canManageReference ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setReferenceError(null)
                    setReferenceModal("country")
                  }}
                >
                  {t("settings.adminOps.reference.createCountryButton")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setReferenceError(null)
                    setReferenceModal("currency")
                  }}
                >
                  {t("settings.adminOps.reference.createCurrencyButton")}
                </Button>
              </>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("currencyRate")}>
              {t("settings.organization.csvImport.toolbarCurrencyRates")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("company")}>
              {t("settings.organization.csvImport.toolbarCompanies")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("role")}>
              {t("settings.organization.csvImport.toolbarRoles")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCsvKind("aiAgent")}>
              {t("settings.organization.csvImport.toolbarAiAgents")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.organization.integrations.title")}</CardTitle>
          <CardDescription>{t("settings.organization.integrations.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Google Drive Integration */}
          <div className="flex items-start justify-between p-4 border rounded-lg">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Cloud className="h-5 w-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h4 className="font-medium">{t("settings.organization.integrations.googleDrive.title")}</h4>
                <p className="text-sm text-muted-foreground">
                  {t("settings.organization.integrations.googleDrive.description")}
                </p>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="gdrive-token">{t("settings.organization.integrations.accessToken")}</Label>
                  <Input
                    id="gdrive-token"
                    type="password"
                    placeholder={t("settings.organization.integrations.tokenPlaceholder")}
                  />
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const token = (document.getElementById('gdrive-token') as HTMLInputElement)?.value
                if (!token) {
                  toast({
                    title: t("settings.organization.integrations.error"),
                    description: t("settings.organization.integrations.tokenRequired"),
                    variant: "destructive",
                  })
                  return
                }
                try {
                  if (!orgReady) return
                  await updateGoogleDriveCredentials.mutateAsync({
                    userId: organizationId.toString(),
                    credentials: { accessToken: token },
                  })
                  toast({
                    title: t("settings.organization.integrations.success"),
                    description: t("settings.organization.integrations.googleDrive.saved"),
                  })
                } catch (error) {
                  toast({
                    title: t("settings.organization.integrations.error"),
                    description: error instanceof Error ? error.message : t("settings.organization.integrations.saveError"),
                    variant: "destructive",
                  })
                }
              }}
              disabled={updateGoogleDriveCredentials.isPending}
            >
              {updateGoogleDriveCredentials.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("settings.organization.integrations.connect")}
                </>
              )}
            </Button>
          </div>

          {/* WhatsApp Integration */}
          <div className="flex items-start justify-between p-4 border rounded-lg">
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <MessageCircle className="h-5 w-5 text-green-600 dark:text-green-300" />
              </div>
              <div>
                <h4 className="font-medium">{t("settings.organization.integrations.whatsapp.title")}</h4>
                <p className="text-sm text-muted-foreground">
                  {t("settings.organization.integrations.whatsapp.description")}
                </p>
                <div className="mt-3 space-y-2">
                  <Label htmlFor="wa-api-key">{t("settings.organization.integrations.apiKey")}</Label>
                  <Input
                    id="wa-api-key"
                    type="password"
                    placeholder={t("settings.organization.integrations.apiKeyPlaceholder")}
                  />
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const apiKey = (document.getElementById('wa-api-key') as HTMLInputElement)?.value
                if (!apiKey) {
                  toast({
                    title: t("settings.organization.integrations.error"),
                    description: t("settings.organization.integrations.apiKeyRequired"),
                    variant: "destructive",
                  })
                  return
                }
                try {
                  if (!orgReady) return
                  await updateWhatsappCredentials.mutateAsync({
                    userId: organizationId.toString(),
                    credentials: { apiKey },
                  })
                  toast({
                    title: t("settings.organization.integrations.success"),
                    description: t("settings.organization.integrations.whatsapp.saved"),
                  })
                } catch (error) {
                  toast({
                    title: t("settings.organization.integrations.error"),
                    description: error instanceof Error ? error.message : t("settings.organization.integrations.saveError"),
                    variant: "destructive",
                  })
                }
              }}
              disabled={updateWhatsappCredentials.isPending}
            >
              {updateWhatsappCredentials.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t("settings.organization.integrations.connect")}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isLoading} size="lg">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("common.saving")}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {t("settings.organization.saveSettings")}
            </>
          )}
        </Button>
      </div>

      {csvKind && csvFormConfig && hasValidOrganizationId(organizationId) ? (
        <FormModal
          key={csvKind}
          open
          onOpenChange={(o) => !o && setCsvKind(null)}
          config={csvFormConfig}
          closeOnSubmit={false}
          submitError={csvError}
          onSubmit={async (data) => {
            setCsvError(null)
            const files = data.csvFile as FileList | undefined
            const file = files?.[0]
            if (!file) {
              setCsvError(t("common.validation.required"))
              return
            }
            try {
              const text = await file.text()
              if (csvKind === "country") await csvImports.importCountry.mutateAsync(text)
              else if (csvKind === "currency") await csvImports.importCurrency.mutateAsync(text)
              else if (csvKind === "currencyRate") await csvImports.importCurrencyRate.mutateAsync(text)
              else if (csvKind === "company") await csvImports.importCompany.mutateAsync(text)
              else if (csvKind === "role") await csvImports.importRole.mutateAsync(text)
              else await csvImports.importAiAgent.mutateAsync(text)
              toast({
                title: t("settings.organization.csvImport.successTitle"),
                description: t("settings.organization.csvImport.successDescription"),
              })
              setCsvKind(null)
            } catch (e) {
              setCsvError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}

      {referenceModal ? (
        <FormModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setReferenceModal(null)
              setReferenceError(null)
            }
          }}
          config={referenceModal === "country" ? countryFormConfig : currencyFormConfig}
          isPending={createCountry.isPending || createCurrency.isPending}
          closeOnSubmit={false}
          submitError={referenceError}
          onSubmit={async (data) => {
            setReferenceError(null)
            try {
              if (referenceModal === "country") {
                await createCountry.mutateAsync({
                  code: String(data.code ?? ""),
                  params: {
                    name: String(data.name ?? ""),
                    iso3: String(data.iso3 ?? ""),
                    numcode: Number(data.numcode ?? 0),
                    phoneCode: String(data.phoneCode ?? ""),
                    officialName: null,
                    currencyCode: null,
                    languageCodes: [],
                    isActive: Boolean(data.isActive),
                    metadata: null,
                  },
                })
              } else {
                await createCurrency.mutateAsync({
                  code: String(data.code ?? ""),
                  params: {
                    name: String(data.name ?? ""),
                    symbol: String(data.symbol ?? ""),
                    decimalPlaces: Number(data.decimalPlaces ?? 2),
                    roundingFactor: 0.01,
                    position: String(data.position ?? "before"),
                    active: Boolean(data.active),
                    metadata: null,
                  },
                })
              }
              toast({
                title: t("settings.adminOps.success"),
              })
              setReferenceModal(null)
            } catch (e) {
              setReferenceError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      ) : null}
    </div>
  )
}
