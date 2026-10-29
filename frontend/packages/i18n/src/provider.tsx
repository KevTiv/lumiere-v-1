"use client"

import { useEffect, type ComponentType, type ReactNode } from "react"
import { I18nextProvider, useTranslation } from "react-i18next"
import { i18n } from "./config"
import { languagePreference, normalizeLanguage } from "./languages"

/** react-i18next FC return type vs React 19 JSX — bridge until upstream aligns. */
const I18nextProviderCompat = I18nextProvider as ComponentType<{
  i18n: typeof i18n
  children: ReactNode
}>

interface I18nProviderProps {
  children: ReactNode
  language?: string
}

export function I18nProvider({ children, language }: I18nProviderProps) {
  const { i18n: activeI18n } = useTranslation()
  useEffect(() => {
    if (language) void i18n.changeLanguage(normalizeLanguage(language))
  }, [language])
  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.lang = languagePreference(activeI18n.language).language
    document.documentElement.dir = "ltr"
  }, [activeI18n.language])
  return <I18nextProviderCompat i18n={i18n}>{children}</I18nextProviderCompat>
}
