"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useStdbConnection, getStdbConnection } from "@lumiere/stdb"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"

const TIMEZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Dubai", "Australia/Sydney",
]

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"] as const

export default function OnboardingPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { connected } = useStdbConnection()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [timezone, setTimezone] = useState("UTC")
  const [currency, setCurrency] = useState("USD")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!connected) {
      setError(t("auth.onboarding.errors.notConnected"))
      return
    }
    setError(null)
    setLoading(true)
    try {
      const conn = getStdbConnection()
      if (!conn) throw new Error(t("auth.onboarding.errors.noConnection"))
      conn.reducers.createOrganization({
        params: {
          name,
          code,
          timezone,
          dateFormat: "YYYY-MM-DD",
          language: "en",
          isActive: true,
          description: undefined,
          logoUrl: undefined,
          website: undefined,
          email: undefined,
          phone: undefined,
          currencyId: undefined,
          metadata: undefined,
        },
      })
      router.push("/overview")
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.onboarding.errors.failedToCreate"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.onboarding.title")}</CardTitle>
        <CardDescription>{t("auth.onboarding.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("auth.onboarding.orgName")}</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t("auth.onboarding.orgNamePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="code">{t("auth.onboarding.shortCode")}</Label>
            <Input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
              required
              pattern="[A-Z0-9]+"
              maxLength={8}
              placeholder={t("auth.onboarding.shortCodePlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("auth.onboarding.shortCodeHint")}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{t("auth.onboarding.timezone")}</Label>
              <select
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">{t("auth.onboarding.currency")}</Label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {t(`auth.onboarding.currencies.${code}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!connected && (
            <p className="text-sm text-muted-foreground">{t("auth.onboarding.connectingToServer")}</p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loading || !connected}>
            {loading ? t("auth.onboarding.submitting") : t("auth.onboarding.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
