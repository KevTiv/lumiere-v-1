"use client"

import { useMemo, type ReactNode } from "react"
import { useTranslation } from "@lumiere/i18n"
import { useErpSession } from "@lumiere/erp-session"
import { CurrencyFormatProvider } from "@lumiere/ui"
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings"
import { useCompanies } from "@lumiere/query-hooks/hooks/organization-company"
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company"
import { operatingCompanyCurrencyCode, WORKSPACE_ROW_CURRENCY_KEY } from "./operating-company-currency"

/**
 * Gives every table, ledger view and dashboard widget in the workspace its currency lookup: the
 * currency catalog (id → ISO code), the operating company's currency as the fallback, the viewer's
 * language for number formats, and the row field that names a row's currency.
 */
export function EntityCurrencyBoundary({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const { organizationId } = useErpSession()
  const operatingCompanyId = useOperatingCompanyId(organizationId)
  const currencies = useCurrencies()
  const companies = useCompanies(organizationId ?? 0, (organizationId ?? 0) > 0)
  const defaultCode = useMemo(
    () => operatingCompanyCurrencyCode(currencies.data ?? [], companies.data ?? [], operatingCompanyId),
    [currencies.data, companies.data, operatingCompanyId],
  )
  return (
    <CurrencyFormatProvider
      locale={i18n.language}
      defaultCode={defaultCode}
      currencies={currencies.data}
      rowCurrencyKey={WORKSPACE_ROW_CURRENCY_KEY}
    >
      {children}
    </CurrencyFormatProvider>
  )
}
