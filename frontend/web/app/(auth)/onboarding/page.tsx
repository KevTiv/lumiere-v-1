"use client"

import { apiFetch } from '@/lib/api-fetch'
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import {
  ONBOARDING_TIMEZONES,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  DEFAULT_FISCAL_YEAR_END_DAY,
} from "@/lib/onboarding-config"
import { POST_AUTH_PATHS } from "@/lib/post-auth-destination"
import { performSignOut } from "@/lib/auth-sign-out"
import { phCapture, phCaptureException } from "@/lib/posthog-browser"

type BootstrapCurrency = {
  id: number
  code: string
  name: string
}

export default function OnboardingPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [timezone, setTimezone] = useState("UTC")
  const [currencies, setCurrencies] = useState<BootstrapCurrency[]>([])
  const [currencyId, setCurrencyId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function loadCurrencies() {
      try {
        const response = await apiFetch("/api/bootstrap/currencies", { signal: controller.signal })
        if (!response.ok) throw new Error(t("auth.onboarding.errors.failedToCreate"))
        const payload = (await response.json()) as { data?: BootstrapCurrency[] }
        const activeCurrencies = payload.data ?? []
        setCurrencies(activeCurrencies)
        const defaultCurrency = activeCurrencies.find((currency) => currency.code === "USD") ?? activeCurrencies[0]
        setCurrencyId(defaultCurrency ? String(defaultCurrency.id) : "")
        setCurrencyCode(defaultCurrency?.code ?? "")
        if (!defaultCurrency) setError(t("auth.onboarding.errors.failedToCreate"))
      } catch (err) {
        if (!controller.signal.aborted) {
          phCaptureException(err)
          setError(err instanceof Error ? err.message : t("auth.onboarding.errors.failedToCreate"))
        }
      } finally {
        if (!controller.signal.aborted) setCurrenciesLoading(false)
      }
    }
    void loadCurrencies()
    return () => controller.abort()
  }, [t])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const selectedCurrencyId = Number(currencyId)
      if (!Number.isSafeInteger(selectedCurrencyId) || selectedCurrencyId < 0 || !currencyCode) {
        throw new Error(t("auth.onboarding.errors.failedToCreate"))
      }
      const r = await apiFetch("/api/bootstrap/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: {
            name,
            code,
            timezone,
            dateFormat: "YYYY-MM-DD",
            language: "en",
            isActive: true,
            description: null,
            logoUrl: null,
            website: null,
            email: null,
            phone: null,
            currencyId: null,
            metadata: JSON.stringify({ onboardingVersion: 1, currencyId: selectedCurrencyId }),
          },
          defaultCompanyName: name,
          defaultCompanyCode: code,
          defaultCompanyCurrencyId: selectedCurrencyId,
          defaultCompanyCurrencyCode: currencyCode,
          fiscalYearEndMonth: DEFAULT_FISCAL_YEAR_END_MONTH,
          fiscalYearEndDay: DEFAULT_FISCAL_YEAR_END_DAY,
          seedFormConfigs: true,
          settings: {
            moduleConfig: null,
            featureFlags: [],
            integrationKeys: null,
            metadata: JSON.stringify({ bootstrap: "tenant_v1" }),
          },
        }),
      })
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as Record<string, unknown>
        throw new Error((json.error as string | undefined) ?? t("auth.onboarding.errors.failedToCreate"))
      }
      phCapture("onboarding_completed", {
        organization_name: name,
        organization_code: code,
        timezone,
        currency_id: selectedCurrencyId,
      })
      router.push(POST_AUTH_PATHS.overview)
      router.refresh()
    } catch (err) {
      phCaptureException(err)
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
                {ONBOARDING_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">{t("auth.onboarding.currency")}</Label>
              <select
                id="currency"
                value={currencyCode}
                onChange={(e) => {
                  const selected = currencies.find((currency) => currency.code === e.target.value)
                  setCurrencyCode(e.target.value)
                  setCurrencyId(String(selected?.id ?? 0))
                }}
                disabled={currenciesLoading || currencies.length === 0}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || currenciesLoading || currencyId === ""}
          >
            {loading ? t("auth.onboarding.submitting") : t("auth.onboarding.submit")}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              onClick={() => void performSignOut()}
            >
              {t("nav.signOut")}
            </button>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
