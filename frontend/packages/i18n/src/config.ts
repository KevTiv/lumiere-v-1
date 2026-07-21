"use client"

import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"

export type SupportedLanguage = "en" | "pt-BR"

export const defaultLanguage: SupportedLanguage = "en"

/** pt-BR falls back to English chrome until a full locale pack ships; form field labels use `form_field_label`. */
export const resources = {
  en: { translation: en },
  "pt-BR": { translation: en },
} satisfies Record<SupportedLanguage, { translation: typeof en }>

i18next.use(initReactI18next).init({
  lng: defaultLanguage,
  fallbackLng: defaultLanguage,
  resources,
  interpolation: {
    escapeValue: false,
  },
  initImmediate: false,
})

export { i18next as i18n }
