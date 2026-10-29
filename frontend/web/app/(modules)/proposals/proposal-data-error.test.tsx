import React from "react"
import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { i18n } from "@lumiere/i18n"
import { ProposalDataError } from "./proposal-data-error"

Object.assign(globalThis, { React })

test("proposal read failures use the selected language and escape the supplied detail", async () => {
  const language = i18n.language
  i18n.addResource("en", "translation", "proposals.dataUnavailable", "Proposal data is unavailable")
  i18n.addResource("fr", "translation", "proposals.dataUnavailable", "Les propositions sont indisponibles")
  try {
    await i18n.changeLanguage("en")
    assert.match(renderToStaticMarkup(<ProposalDataError status="unavailable" />), /Proposal data is unavailable/)
    await i18n.changeLanguage("fr")
    const html = renderToStaticMarkup(<ProposalDataError status="unavailable" message="<access changed>" />)
    assert.match(html, /Les propositions sont indisponibles/)
    assert.match(html, /&lt;access changed&gt;/)
    assert.doesNotMatch(html, /Proposal data is unavailable/)
  } finally {
    await i18n.changeLanguage(language)
  }
})
