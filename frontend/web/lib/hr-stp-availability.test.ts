import assert from "node:assert/strict"
import test from "node:test"

import { HR_STP_PROVIDER_UNAVAILABLE, hrStpProviderState } from "./hr-stp-availability"

test("STP is explicitly unavailable until a real provider adapter is configured", () => {
  assert.deepEqual(hrStpProviderState(), {
    available: false,
    reason: HR_STP_PROVIDER_UNAVAILABLE,
  })
  assert.match(HR_STP_PROVIDER_UNAVAILABLE, /no provider adapter is configured/i)
  assert.match(HR_STP_PROVIDER_UNAVAILABLE, /No integration intent was created/i)
})
