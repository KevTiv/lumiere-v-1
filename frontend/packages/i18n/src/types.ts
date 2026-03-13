import type en from "./locales/en.json"

export type TranslationResources = typeof en

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      translation: TranslationResources
    }
  }
}
