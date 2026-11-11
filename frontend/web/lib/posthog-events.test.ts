import assert from "node:assert/strict"
import { test } from "node:test"
import { readPostHogProjectToken } from "./posthog-config"
import { analyticsDistinctId, analyticsPage, filterAnalyticsEvent } from "./posthog-events"

test("analytics IDs match authenticated SpacetimeDB identities", () => {
  assert.equal(analyticsDistinctId("AB".repeat(32)), `lumiere:${"ab".repeat(32)}`)
  assert.equal(analyticsDistinctId(` 0X${"AB".repeat(32)} `), `lumiere:${"ab".repeat(32)}`)
  assert.equal(analyticsDistinctId("alice@example.test"), undefined)
  assert.equal(analyticsDistinctId("unknown"), undefined)
  assert.equal(analyticsDistinctId(undefined), undefined)
})

test("analytics pageviews exclude dynamic segments and URL metadata", () => {
  assert.equal(analyticsPage("/documents/private-contract"), "/documents")
  assert.equal(analyticsPage("/invite/alice@example.test"), "/other")
  const sanitized = filterAnalyticsEvent({
    event: "$pageview",
    $set: { email: "alice@example.test" },
    $set_once: { $initial_referrer: "https://example.test/private" },
    properties: {
      $pathname: "/sales/orders/42",
      $current_url: "https://example.test/sales/orders/42?secret=1",
      $referrer: "https://example.test/private",
      $initial_current_url: "https://example.test/private",
      distinct_id: `lumiere:${"ab".repeat(32)}`,
      $session_id: "1f4342df-9096-4357-8df0-334344d66eb3",
    },
  })
  assert.deepEqual(sanitized?.properties, {
    $geoip_disable: true,
    $pathname: "/sales",
    distinct_id: `lumiere:${"ab".repeat(32)}`,
    $session_id: "1f4342df-9096-4357-8df0-334344d66eb3",
  })
  assert.equal(sanitized?.$set, undefined)
  assert.equal(sanitized?.$set_once, undefined)
})

test("assistant intent keeps scoped identifiers and discards prompts", () => {
  assert.deepEqual(
    filterAnalyticsEvent({
      event: "assistant_turn_submitted",
      properties: {
        organization_id: 42n,
        company_id: 99,
        query: "Summarize the private order.",
        error: "User email is alice@example.test",
      },
    })?.properties,
    { $geoip_disable: true, organization_id: "42", company_id: "99" },
  )
})

test("private profiles and automatic events are excluded", () => {
  assert.deepEqual(
    filterAnalyticsEvent({
      event: "$identify",
      properties: {
        $anon_distinct_id: "alice@example.test",
        $set: { email: "alice@example.test" },
      },
    })?.properties,
    { $geoip_disable: true },
  )
  assert.equal(
    filterAnalyticsEvent({ event: "$exception", properties: { error: "private" } }),
    null,
  )
  assert.equal(filterAnalyticsEvent({ event: "$autocapture" }), null)
})

test("only a public project token can be serialized for the browser", () => {
  const runtime = process.env.POSTHOG_WEB_TOKEN
  const fallback = process.env.NEXT_PUBLIC_POSTHOG_TOKEN
  try {
    process.env.POSTHOG_WEB_TOKEN = "phx_personal_key"
    process.env.NEXT_PUBLIC_POSTHOG_TOKEN = "phc_development_key"
    assert.equal(readPostHogProjectToken(), undefined)
    process.env.POSTHOG_WEB_TOKEN = " phc_railway_project "
    assert.equal(readPostHogProjectToken(), "phc_railway_project")
    process.env.POSTHOG_WEB_TOKEN = ""
    assert.equal(readPostHogProjectToken(), "phc_development_key")
  } finally {
    if (runtime === undefined) delete process.env.POSTHOG_WEB_TOKEN
    else process.env.POSTHOG_WEB_TOKEN = runtime
    if (fallback === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_TOKEN
    else process.env.NEXT_PUBLIC_POSTHOG_TOKEN = fallback
  }
})
