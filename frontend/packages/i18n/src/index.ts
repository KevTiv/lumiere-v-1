export { I18nProvider } from "./provider"
export { i18n, defaultLanguage, resources } from "./config"
export type { SupportedLanguage } from "./config"
export type { TranslationResources } from "./types"

// Re-export typed useTranslation hook from react-i18next
export { useTranslation, Trans } from "react-i18next"

// Ensure type augmentation is applied
import "./types"
