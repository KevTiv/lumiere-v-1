import assert from "node:assert/strict"
import test from "node:test"
import { toCreateCalendarEventParams } from "./calendar-create-params"

test("calendar creation rejects a reversed range without inventing dates", () => {
  assert.equal(toCreateCalendarEventParams({ name: "Review", start: "2026-10-06T10:00", stop: "2026-10-06T09:00" }), null)
  assert.equal(toCreateCalendarEventParams({ name: "Review", start: "no date", stop: "2026-10-06T09:00" }), null)
})

test("calendar creation keeps accepted equal-time all-day semantics and submitted defaults", () => {
  const params = toCreateCalendarEventParams({ name: " Company day ", start: "2026-10-06T00:00", stop: "2026-10-06T00:00", allday: true, privacy: "private", location: "Main office" })
  assert.equal(params?.name, "Company day")
  assert.equal(params?.allday, true)
  assert.deepEqual(params?.start, params?.stop)
  assert.equal(params?.privacy, "private")
  assert.equal(params?.location, "Main office")
  assert.equal(params?.state, "confirmed")
  assert.deepEqual(params?.partnerIds, [])
})
