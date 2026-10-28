"use client"

import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import templatePtBr from "./locales/pt-BR-templates.json"
import fr from "./locales/fr.json"
import rw from "./locales/rw.json"
import rwEnglish from "./locales/rw-x-en.json"
import sw from "./locales/sw.json"
import { defaultLanguage, fallbackLanguages } from "./languages"
export { defaultLanguage } from "./languages"
export type { SupportedLanguage } from "./languages"

/** Partial packs use i18next fallback so coverage remains measurable. */
export const resources = {
  en: { translation: en },
  fr: { translation: fr },
  rw: { translation: rw },
  // French-derived loanwords are the base Kinyarwanda wording.
  "rw-x-fr": { translation: rw },
  "rw-x-en": { translation: rwEnglish },
  sw: { translation: sw },
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
}

i18next.use(initReactI18next).init({
  lng: defaultLanguage,
  fallbackLng: fallbackLanguages,
  supportedLngs: Object.keys(resources),
  // Resolve rw-x-fr / rw-x-en before the shared Kinyarwanda pack.
  load: "all",
  resources,
  interpolation: {
    escapeValue: false,
  },
  initImmediate: false,
})

export { i18next as i18n }
