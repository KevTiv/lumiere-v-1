import type { ComponentType, ReactNode } from "react"
import { I18nextProvider } from "react-i18next"
import { i18n } from "./config"

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
  if (language && i18n.language !== language) {
    i18n.changeLanguage(language)
  }
  return <I18nextProviderCompat i18n={i18n}>{children}</I18nextProviderCompat>
}
