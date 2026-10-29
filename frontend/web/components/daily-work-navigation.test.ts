import assert from "node:assert/strict"
import test from "node:test"
import { dailyWorkHref } from "./daily-work-navigation"

test("overview hands the same work filters to My work without unrelated page state", () => {
  const href = dailyWorkHref(new URLSearchParams("workSource=activities&workView=mine&workTeam=department%3A12&workScope=sales&workLayout=list&tab=dashboard&selected=99"))
  const url = new URL(href, "https://lumiere.invalid")
  assert.equal(url.pathname, "/tasks")
  assert.equal(url.searchParams.get("workTeam"), "department:12")
  assert.equal(url.searchParams.get("workSource"), "activities")
  assert.equal(url.searchParams.get("workScope"), "sales")
  assert.equal(url.searchParams.get("workView"), "mine")
  assert.equal(url.searchParams.get("workLayout"), "list")
  assert.equal(url.searchParams.has("selected"), false)
  assert.equal(url.searchParams.has("tab"), false)
  assert.equal(dailyWorkHref(new URLSearchParams()), "/tasks")
})
