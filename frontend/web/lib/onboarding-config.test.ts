import assert from "node:assert/strict"
import test from "node:test"
import { isOnboardingTimezone, onboardingFiscalYearEnd, onboardingTimezones } from "./onboarding-config"

test("onboarding timezones include regional choices, UTC and the browser suggestion", () => {
  const choices = onboardingTimezones("Pacific/Chatham")
  for (const zone of ["UTC", "Africa/Kigali", "Africa/Nairobi", "Pacific/Chatham"]) assert.ok(choices.includes(zone))
  assert.equal(new Set(choices).size, choices.length)
  assert.ok(choices.length > 100)
  assert.ok(!onboardingTimezones("Invalid/Zone").includes("Invalid/Zone"))
  assert.equal(isOnboardingTimezone(""), false)
  assert.equal(isOnboardingTimezone("Invalid/Zone"), false)
})

test("annual fiscal year-end validates exact month/day instead of normalizing invalid dates", () => {
  assert.deepEqual(onboardingFiscalYearEnd("6", "30"), { month: 6, day: 30 })
  assert.deepEqual(onboardingFiscalYearEnd(12, 31), { month: 12, day: 31 })
  assert.deepEqual(onboardingFiscalYearEnd("2", "28"), { month: 2, day: 28 })
  for (const [month, day] of [[2, 29], [4, 31], [0, 1], [13, 1], [1, 0], [1, 32], [1.5, 1], ["", 1], ["June", 30]]) {
    assert.equal(onboardingFiscalYearEnd(month, day), null, `${month}/${day}`)
  }
})
