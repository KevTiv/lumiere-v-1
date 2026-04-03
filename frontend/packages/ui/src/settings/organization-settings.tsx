"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Building, Save, Loader2 } from "lucide-react"

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
    setIsLoading(true)
    try {
      // Get organization ID from session - in real implementation this comes from context
      const organizationId = 1 // Placeholder - should come from session context
      
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
    setIsLoading(true)
    try {
      const organizationId = 1 // Placeholder - should come from session context
      
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
    </div>
  )
}
