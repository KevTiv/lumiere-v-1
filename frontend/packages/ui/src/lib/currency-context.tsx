"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"

import { formatCurrencyAmount, resolveCurrencyCode } from "./entity-row-utils"
import { unwrapEntityValue } from "./entity-row-values"

interface CurrencyFormatContextValue {
  locale?: string
  defaultCode?: string
  codesById?: ReadonlyMap<string, string>
}

const CurrencyFormatContext = createContext<CurrencyFormatContextValue>({})

interface CurrencyFormatProviderProps {
  /** BCP 47 tag the user reads numbers and amounts in (usually the UI language). */
  locale?: string
  /** ISO 4217 code for amounts that name no currency, e.g. the operating company's. */
  defaultCode?: string
  /** Currency records, so rows that carry a currency id can show that currency. */
  currencies?: ReadonlyArray<{ id?: unknown; code?: unknown }>
  children: ReactNode
}

/**
 * Tells the shared money formatting which locale and currencies apply below it. Providers nest:
 * anything left out is inherited from the one above.
 */
export function CurrencyFormatProvider({ locale, defaultCode, currencies, children }: CurrencyFormatProviderProps) {
  const parent = useContext(CurrencyFormatContext)
  const value = useMemo<CurrencyFormatContextValue>(() => {
    let codesById = parent.codesById
    if (currencies) {
      const map = new Map<string, string>()
      for (const currency of currencies) {
        const code = resolveCurrencyCode(currency.code)
        if (code && currency.id != null) map.set(String(unwrapEntityValue(currency.id)), code)
      }
      codesById = map
    }
    return {
      locale: locale ?? parent.locale,
      defaultCode: resolveCurrencyCode(defaultCode) ?? parent.defaultCode,
      codesById,
    }
  }, [locale, defaultCode, currencies, parent])
  return <CurrencyFormatContext.Provider value={value}>{children}</CurrencyFormatContext.Provider>
}

export interface CurrencyFormat {
  locale?: string
  defaultCode?: string
  /** ISO code for a row's currency value (an ISO code or a currency record id); undefined if unknown. */
  codeFor: (raw: unknown) => string | undefined
  /** An amount in `currency` (a code or record id), else in the default currency. */
  money: (value: number, currency?: unknown) => string
  /** A calendar date, in the order the browser's own settings use. */
  date: (millis: number) => string
}

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }

export function useCurrencyFormat(): CurrencyFormat {
  const { locale, defaultCode, codesById } = useContext(CurrencyFormatContext)
  return useMemo(() => {
    const codeFor = (raw: unknown): string | undefined =>
      resolveCurrencyCode(raw) ?? codesById?.get(String(unwrapEntityValue(raw)))
    return {
      locale,
      defaultCode,
      codeFor,
      money: (value, currency) => formatCurrencyAmount(value, codeFor(currency) ?? defaultCode, { locale }),
      date: (millis) => new Date(millis).toLocaleDateString(undefined, DATE_OPTIONS),
    }
  }, [locale, defaultCode, codesById])
}
