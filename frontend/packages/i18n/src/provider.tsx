import type { ReactNode } from "react"
import { I18nextProvider } from "react-i18next"
import { i18n } from "./config"

interface I18nProviderProps {
  children: ReactNode
  language?: string
}

export function I18nProvider({ children, language }: I18nProviderProps) {
  if (language && i18n.language !== language) {
    i18n.changeLanguage(language)
  }
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
