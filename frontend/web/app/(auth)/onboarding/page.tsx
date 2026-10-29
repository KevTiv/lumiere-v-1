"use client"

import { apiFetch } from '@/lib/api-fetch'
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@lumiere/ui"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@lumiere/ui/components/card"
import { Input } from "@lumiere/ui/components/input"
import { Label } from "@lumiere/ui/components/label"
import { SetupConfirmation } from "./setup-confirmation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  isOnboardingTimezone,
  onboardingFiscalYearEnd,
  onboardingTimezones,
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
  const [timezone, setTimezone] = useState("")
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([])
  const [browserTimezone, setBrowserTimezone] = useState("")
  const [fiscalMonth, setFiscalMonth] = useState(String(DEFAULT_FISCAL_YEAR_END_MONTH))
  const [fiscalDay, setFiscalDay] = useState(String(DEFAULT_FISCAL_YEAR_END_DAY))
  const [setupConfirmed, setSetupConfirmed] = useState(false)
  const [currencies, setCurrencies] = useState<BootstrapCurrency[]>([])
  const [currencyId, setCurrencyId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const suggested = Intl.DateTimeFormat().resolvedOptions().timeZone
    setTimezoneOptions(onboardingTimezones(suggested))
    if (isOnboardingTimezone(suggested)) {
      setBrowserTimezone(suggested)
      setTimezone((current) => current || suggested)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    async function loadCurrencies() {
      try {
        const response = await apiFetch("/api/bootstrap/currencies", { signal: controller.signal })
        if (!response.ok) throw new Error(t("auth.onboarding.errors.failedToCreate"))
        const payload = (await response.json()) as { data?: BootstrapCurrency[] }
        const activeCurrencies = payload.data ?? []
        setCurrencies(activeCurrencies)
        if (activeCurrencies.length === 0) setError(t("auth.onboarding.errors.failedToCreate"))
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
      const selectedCurrency = currencies.find((currency) => String(currency.id) === currencyId && currency.code === currencyCode)
      if (!selectedCurrency || !Number.isSafeInteger(selectedCurrencyId) || selectedCurrencyId < 0) {
        throw new Error(t("auth.onboarding.errors.failedToCreate"))
      }
      const fiscalYearEnd = onboardingFiscalYearEnd(fiscalMonth, fiscalDay)
      if (!isOnboardingTimezone(timezone) || !fiscalYearEnd || !setupConfirmed) {
        throw new Error(t("auth.onboarding.errors.confirmSetup", { defaultValue: "Choose a valid timezone and fiscal year-end, then confirm your company settings." }))
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
          fiscalYearEndMonth: fiscalYearEnd.month,
          fiscalYearEndDay: fiscalYearEnd.day,
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{t("auth.onboarding.timezone")}</Label>
              <Select value={timezone} onValueChange={(value) => { setTimezone(value); setSetupConfirmed(false) }}>
                <SelectTrigger id="timezone">
                  <SelectValue placeholder={t("auth.onboarding.chooseTimezone", { defaultValue: "Choose timezone" })} />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {browserTimezone && <p className="text-xs text-muted-foreground">{t("auth.onboarding.browserTimezoneHint", { defaultValue: "Browser suggestion: {{timezone}}. Confirm the timezone your company uses.", timezone: browserTimezone })}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency">{t("auth.onboarding.currency")}</Label>
              <Select
                value={currencyCode}
                onValueChange={(code) => {
                  const selected = currencies.find((currency) => currency.code === code)
                  // Form-associated selects can emit an empty value while their
                  // options initialize. It is not a supported currency choice.
                  if (!selected) return
                  setCurrencyCode(selected.code)
                  setCurrencyId(String(selected.id))
                  setSetupConfirmed(false)
                }}
                disabled={currenciesLoading || currencies.length === 0}
              >
                <SelectTrigger id="currency">
                  <SelectValue placeholder={t("auth.onboarding.chooseCurrency", { defaultValue: "Choose base currency" })} />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.code} — {currency.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("auth.onboarding.currencyHint", { defaultValue: "Choose the company's accounting base currency. No currency is selected automatically." })}</p>
            </div>
          </div>

          <fieldset className="space-y-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("auth.onboarding.fiscalYearEnd", { defaultValue: "Fiscal year-end" })}</legend>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label htmlFor="fiscal-month">{t("auth.onboarding.fiscalMonth", { defaultValue: "Month (1–12)" })}</Label><Input id="fiscal-month" type="number" min={1} max={12} step={1} required value={fiscalMonth} onChange={(event) => { setFiscalMonth(event.target.value); setSetupConfirmed(false) }} /></div>
              <div className="space-y-1.5"><Label htmlFor="fiscal-day">{t("auth.onboarding.fiscalDay", { defaultValue: "Day" })}</Label><Input id="fiscal-day" type="number" min={1} max={31} step={1} required value={fiscalDay} onChange={(event) => { setFiscalDay(event.target.value); setSetupConfirmed(false) }} /></div>
            </div>
            <p className="text-xs text-muted-foreground">{t("auth.onboarding.fiscalHint", { defaultValue: "Review the suggested December 31 year-end. Choose a month and day that exist every year." })}</p>
            {!onboardingFiscalYearEnd(fiscalMonth, fiscalDay) && <p role="alert" className="text-sm text-destructive">{t("auth.onboarding.errors.fiscalDate", { defaultValue: "Enter a valid annual year-end, such as June 30 or December 31." })}</p>}
          </fieldset>

          <SetupConfirmation checked={setupConfirmed} onCheckedChange={setSetupConfirmed} label={t("auth.onboarding.confirmSetup", { defaultValue: "I have checked the base currency, company timezone and fiscal year-end." })} />

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || currenciesLoading || currencyId === "" || !isOnboardingTimezone(timezone) || !onboardingFiscalYearEnd(fiscalMonth, fiscalDay) || !setupConfirmed}
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
