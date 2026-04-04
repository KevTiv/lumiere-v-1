"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Building, Save, Loader2, Cloud, MessageCircle, ExternalLink, Upload } from "lucide-react"
import { useUpdateGoogleDriveCredentials, useUpdateWhatsappCredentials } from "@/hooks/auth"
import { useOrgMasterCsvImportMutations } from "@/hooks/org-master-csv-imports"
import { useStdbConnection } from "@lumiere/stdb"
import { csvImportForm, FormModal } from "@lumiere/ui"
import { hasValidOrganizationId } from "@/lib/org-scoped"

type OrgMasterCsvKind =
  | "country"
  | "currency"
  | "currencyRate"
  | "company"
  | "role"
  | "aiAgent"

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
  const { organizationId } = useStdbConnection()
  const [csvKind, setCsvKind] = useState<OrgMasterCsvKind | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)

  const orgReady = hasValidOrganizationId(organizationId)
  const orgId = orgReady ? organizationId : 0
  const orgBigInt = orgReady ? BigInt(organizationId) : 0n
  const csvImports = useOrgMasterCsvImportMutations(orgId)

  useEffect(() => {
    if (csvKind) setCsvError(null)
  }, [csvKind])

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
      const response = await fetch('/api/call/upsert_organization_settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), settings]),
      })

      if (!response.ok) {
        throw new Error('Failed to save organization settings')
      }

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
      const response = await fetch('/api/call/update_organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([organizationId.toString(), {
          name: settings.name,
          description: settings.description,
        }]),
      })

      if (!response.ok) {
        throw new Error('Failed to update organization')
      }

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

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.organization.address")}</CardTitle>
          <CardDescription>{t("settings.organization.addressDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-street">{t("settings.organization.street")}</Label>
            <Input
              id="org-street"
              value={settings.address.street}
              onChange={(e) => setSettings({
                ...settings,
                address: { ...settings.address, street: e.target.value }
              })}
              placeholder={t("settings.organization.streetPlaceholder")}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="org-city">{t("settings.organization.city")}</Label>
              <Input
                id="org-city"
                value={settings.address.city}
                onChange={(e) => setSettings({
                  ...settings,
                  address: { ...settings.address, city: e.target.value }
                })}
                placeholder={t("settings.organization.cityPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-state">{t("settings.organization.state")}</Label>
              <Input
                id="org-state"
                value={settings.address.state}
                onChange={(e) => setSettings({
                  ...settings,
                  address: { ...settings.address, state: e.target.value }
                })}
                placeholder={t("settings.organization.statePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-zip">{t("settings.organization.zip")}</Label>
              <Input
                id="org-zip"
                value={settings.address.zip}
                onChange={(e) => setSettings({
                  ...settings,
                  address: { ...settings.address, zip: e.target.value }
                })}
                placeholder={t("settings.organization.zipPlaceholder")}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-country">{t("settings.organization.country")}</Label>
            <Input
              id="org-country"
              value={settings.address.country}
              onChange={(e) => setSettings({
                ...settings,
                address: { ...settings.address, country: e.target.value }
              })}
              placeholder={t("settings.organization.countryPlaceholder")}
            />
          </div>
        </CardContent>
      </Card>

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
    </div>
  )
}
