import assert from "node:assert/strict"
import test from "node:test"
import { i18n } from "@lumiere/i18n"
import { operationalLabel } from "./operational-labels"

test("operational enum labels follow the current language while provider names remain unchanged", async () => {
  const previousLanguage = i18n.language
  i18n.addResource("en", "translation", "accounting.operationalLabels.Draft", "Draft")
  i18n.addResource("fr", "translation", "accounting.operationalLabels.Draft", "Brouillon")
  try {
    await i18n.changeLanguage("en")
    assert.equal(operationalLabel("Draft"), "Draft")
    await i18n.changeLanguage("fr")
    assert.equal(operationalLabel("Draft"), "Brouillon")
    assert.equal(operationalLabel("Wave"), "Wave")
    assert.equal(operationalLabel("NewProvider"), "NewProvider")
  } finally {
    await i18n.changeLanguage(previousLanguage)
  }
})
