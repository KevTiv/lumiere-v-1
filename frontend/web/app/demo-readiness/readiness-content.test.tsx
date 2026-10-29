import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n } from "@lumiere/i18n"
import { DemoReadinessContent, type DemoReadinessCheck } from "./readiness-content"

Object.assign(globalThis, { React })

test("readiness results localize structured statuses without changing resource IDs or links", async () => {
  const language = i18n.language
  const checks: DemoReadinessCheck[] = [{ moduleKey: "inventory", href: "/inventory", results: [
    { resource: "products", status: "rows", count: 1 },
    { resource: "stock-quants", status: "rows", count: 3 },
    { resource: "warehouses", status: "rows", count: 0 },
    { resource: "stock-moves", status: "http-error", httpStatus: 403 },
    { resource: "stock-inventories", status: "unexpected-response" },
    { resource: "warehouse-tasks", status: "unavailable" },
  ] }]
  i18n.addResourceBundle("fr", "translation", { demoReadiness: {
    modules: { inventory: "Stock et entrepôts" },
    rowsReturned_one: "{{count}} ligne retournée", rowsReturned_other: "{{count}} lignes retournées",
    queryFailed: "Échec de la requête (HTTP {{status}})", empty: "Aucun résultat",
    unexpectedResponse: "Réponse inattendue", queryUnavailable: "Requête indisponible",
  } }, true, true)
  try {
    await i18n.changeLanguage("en")
    const before = renderToStaticMarkup(<DemoReadinessContent checks={checks} />)
    await i18n.changeLanguage("fr")
    const after = renderToStaticMarkup(<DemoReadinessContent checks={checks} />)
    assert.match(after, /Stock et entrepôts/)
    assert.match(after, /1 ligne retournée/)
    assert.match(after, /3 lignes retournées/)
    assert.match(after, /Aucun résultat/)
    assert.match(after, /Échec de la requête \(HTTP 403\)/)
    assert.match(after, /Réponse inattendue/)
    assert.match(after, /Requête indisponible/)
    for (const html of [before, after]) {
      assert.match(html, /href="\/overview"/)
      assert.match(html, /href="\/inventory"/)
      for (const result of checks[0]!.results) assert.ok(html.includes(result.resource))
    }
    assert.equal(checks[0]!.results[1]?.status, "rows")
  } finally {
    await i18n.changeLanguage(language)
  }
})
