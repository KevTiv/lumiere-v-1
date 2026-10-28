/** Private-use tags preserve the loanword choice in the existing account language field. */
export const languageOptions = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "rw", label: "Kinyarwanda" },
  { value: "sw", label: "Kiswahili" },
  { value: "pt-BR", label: "Português (Brasil)" },
] as const

export type DisplayLanguage = (typeof languageOptions)[number]["value"]
export type LoanwordLanguage = "en" | "fr"
export type SupportedLanguage = DisplayLanguage | "rw-x-en" | "rw-x-fr"
export const defaultLanguage: SupportedLanguage = "en"

export function languagePreference(value?: string | null): {
  language: DisplayLanguage
  loanwords: LoanwordLanguage
} {
  const tag = value?.trim().replaceAll("_", "-").toLowerCase() ?? "en"
  if (tag.split("-")[0] === "rw") {
    return { language: "rw", loanwords: tag === "rw-x-fr" ? "fr" : "en" }
  }
  if (tag === "pt-br") return { language: "pt-BR", loanwords: "en" }
  const base = tag.split("-")[0]
  return { language: base === "fr" || base === "sw" ? base : "en", loanwords: base === "fr" ? "fr" : "en" }
}

export function profileLanguage(language: DisplayLanguage, loanwords: LoanwordLanguage): SupportedLanguage {
  return language === "rw" ? `rw-x-${loanwords}` : language
}

export function normalizeLanguage(value?: string | null): SupportedLanguage {
  const { language, loanwords } = languagePreference(value)
  return profileLanguage(language, loanwords)
}

/** Swahili always falls back to English; Kinyarwanda follows the account's loanword choice. */
export function fallbackLanguages(code?: string): string[] {
  return languagePreference(code).language === "rw" && languagePreference(code).loanwords === "fr"
    ? ["rw", "fr", "en"]
    : ["en"]
}

export function formattingLocale(value?: string): string {
  const { language } = languagePreference(value)
  return language === "rw" ? "rw-RW" : language === "sw" ? "sw-KE" : language
}
