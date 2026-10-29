import assert from "node:assert/strict"
import test from "node:test"
import { i18n } from "@lumiere/i18n"
import { attemptStatusLabel, reservationStatusLabel, runStepOutcomeLabel } from "./enum-labels"

test("economics labels and sanitized transcript facts follow language changes", async () => {
  const language = i18n.language
  i18n.addResource("en", "translation", "aiHarness.enums.attemptStatuses.outcome_unknown", "Outcome unknown")
  i18n.addResource("fr", "translation", "aiHarness.enums.attemptStatuses.outcome_unknown", "Résultat inconnu")
  i18n.addResource("fr", "translation", "aiHarness.enums.reservationStatuses.reserved", "Réservé")
  i18n.addResource("fr", "translation", "aiHarness.runMetrics.rows_one", "{{count}} ligne")
  i18n.addResource("fr", "translation", "aiHarness.runMetrics.rows_other", "{{count}} lignes")
  try {
    await i18n.changeLanguage("en")
    assert.equal(attemptStatusLabel(i18n.t, "outcome_unknown"), "Outcome unknown")
    await i18n.changeLanguage("fr")
    assert.equal(attemptStatusLabel(i18n.t, "outcome_unknown"), "Résultat inconnu")
    assert.equal(reservationStatusLabel(i18n.t, "reserved"), "Réservé")
    assert.equal(reservationStatusLabel(i18n.t, "future_state"), "future_state")
    const step = { error: false, outputRowCount: 2, resultSummary: "untrusted provider text" }
    assert.equal(runStepOutcomeLabel(i18n.t, step), "2 lignes")
    assert.equal(runStepOutcomeLabel(i18n.t, { ...step, outputRowCount: 1 }), "1 ligne")
    assert.equal(step.resultSummary, "untrusted provider text")
  } finally {
    await i18n.changeLanguage(language)
  }
})
