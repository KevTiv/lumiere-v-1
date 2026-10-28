import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it } from "vitest"
import { createInstance } from "i18next"
import { I18nProvider, i18n, resources, normalizeLanguage, languagePreference, profileLanguage, formattingLocale, useTranslation } from "@lumiere/i18n"
import { fallbackLanguages } from "../../../i18n/src/languages"

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await i18n.changeLanguage("en") })

it("normalizes regional and legacy profiles and persists explicit loanword variants", () => {
  expect(normalizeLanguage("fr-CA")).toBe("fr")
  expect(normalizeLanguage("sw_TZ")).toBe("sw")
  expect(normalizeLanguage("rw")).toBe("rw-x-en")
  expect(normalizeLanguage("rw-x-fr")).toBe("rw-x-fr")
  expect(normalizeLanguage("pt-br")).toBe("pt-BR")
  expect(normalizeLanguage("unsupported")).toBe("en")
  expect(languagePreference("sw")).toEqual({ language: "sw", loanwords: "en" })
  expect(languagePreference("fr")).toEqual({ language: "fr", loanwords: "fr" })
  expect(profileLanguage("rw", "fr")).toBe("rw-x-fr")
  expect(profileLanguage("sw", "fr")).toBe("sw")
  expect(formattingLocale("rw-x-fr")).toBe("rw-RW")
})

it("resolves shared Kinyarwanda with different loanwords and the correct fallback language", async () => {
  const instance = createInstance()
  await instance.init({ resources: structuredClone(resources), fallbackLng: fallbackLanguages, lng: "rw-x-fr", interpolation: { escapeValue: false } })
  expect(instance.t("nav.reports")).toBe("Raporo")
  expect(instance.t("common.save")).toBe("Bika")
  await instance.changeLanguage("rw-x-en")
  expect(instance.t("nav.reports")).toBe("Report")
  expect(instance.t("common.save")).toBe("Bika")
  // A synthetic future string tests fallback even when catalog coverage grows.
  const futureKey = "test.future"
  instance.addResource("fr", "translation", futureKey, "Texte français")
  instance.addResource("en", "translation", futureKey, "English text")
  await instance.changeLanguage("rw-x-fr")
  expect(instance.t(futureKey)).toBe("Texte français")
  await instance.changeLanguage("rw-x-en")
  expect(instance.t(futureKey)).toBe("English text")
  await instance.changeLanguage("sw")
  expect(instance.t(futureKey)).toBe("English text")
  expect(instance.t("common.save")).toBe("Hifadhi")
})

it("updates mounted content and document language after a saved language is restored", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  function Content() { const { t } = useTranslation(); return <span>{t("common.save")}</span> }
  await act(async () => { root.render(<I18nProvider language="fr"><Content /></I18nProvider>) })
  expect(host.textContent).toBe("Enregistrer")
  expect(document.documentElement.lang).toBe("fr")
  await act(async () => { root.render(<I18nProvider language="rw-x-fr"><Content /></I18nProvider>) })
  expect(host.textContent).toBe("Bika")
  expect(document.documentElement.lang).toBe("rw")
  await act(async () => root.unmount())
  host.remove()
})
