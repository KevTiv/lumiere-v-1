"use client"

import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import templatePtBr from "./locales/pt-BR-templates.json"

export type SupportedLanguage = "en" | "pt-BR"

export const defaultLanguage: SupportedLanguage = "en"

/** Template creation/reuse has a pt-BR pack; other chrome retains its English fallback. */
export const resources = {
  en: { translation: en },
  "pt-BR": {
    translation: {
      ...en,
      common: {
        ...en.common,
        ...templatePtBr.common,
        discardChanges: {
          ...en.common.discardChanges,
          ...templatePtBr.common.discardChanges,
        },
      },
      documents: {
        ...en.documents,
        designer: {
          ...en.documents.designer,
          ...templatePtBr.documents.designer,
        },
        studio: { ...en.documents.studio, ...templatePtBr.documents.studio },
        templatePicker: {
          ...en.documents.templatePicker,
          ...templatePtBr.documents.templatePicker,
        },
      },
      sales: {
        ...en.sales,
        quotationDocument: {
          ...en.sales.quotationDocument,
          ...templatePtBr.sales.quotationDocument,
        },
      },
    },
  },
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
