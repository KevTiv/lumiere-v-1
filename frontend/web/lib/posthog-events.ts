const eventProperties = {
  $identify: [],
  $pageview: ["$pathname"],
  assistant_opened: ["organization_id", "company_id"],
  assistant_turn_submitted: ["organization_id", "company_id"],
  assistant_recovery_clicked: ["organization_id", "company_id"],
  user_sign_in_failed: ["method"],
  user_signed_in: ["method"],
  user_sign_up_failed: ["method"],
  user_signed_up: ["method"],
  onboarding_completed: [],
  workflow_transition: [
    "organization_id",
    "transitionId",
    "attempt",
    "status",
    "errorKind",
    "httpStatus",
    "refreshed",
    "durationMs",
    "dispatch",
  ],
  ai_import_analyzed: ["entity", "mapped_columns"],
  ai_import_completed: ["entity", "rows_imported", "ai_mapped", "duplicates_skipped"],
  ai_action_draft_approved: ["reducer"],
  helpdesk_ticket_closed: [],
  sale_order_confirmed: ["organization_id"],
  sale_order_cancelled: ["organization_id"],
  sale_order_created: ["organization_id"],
  proposal_analysis_requested: ["organization_id"],
  crm_record_action: ["organization_id", "record_kind", "action"],
  crm_follow_up_scheduled: ["organization_id", "record_kind"],
  lead_created: ["organization_id"],
  opportunity_converted_to_order: ["organization_id"],
} as const

export type BrowserAnalyticsEvent = Exclude<keyof typeof eventProperties, "$identify">
type AnalyticsValue = string | number | boolean
type EventProperty<E extends keyof typeof eventProperties> = (typeof eventProperties)[E][number]

export type BrowserAnalyticsProperties<E extends BrowserAnalyticsEvent> = Partial<
  Record<EventProperty<E>, AnalyticsValue | bigint | null>
>

const pages = new Set([
  "overview",
  "accounting",
  "sales",
  "crm",
  "purchasing",
  "reports",
  "subscriptions",
  "expenses",
  "products",
  "warehouse",
  "inventory",
  "fleet",
  "tasks",
  "approvals",
  "documents",
  "calendar",
  "settings",
  "ai-harness",
  "ai-skills",
  "sign-in",
  "sign-up",
  "onboarding",
  "helpdesk",
  "proposals",
])

export function analyticsPage(pathname: string): string {
  const segment = pathname.split("/")[1]
  return !segment ? "/" : pages.has(segment) ? `/${segment}` : "/other"
}

export function analyticsDistinctId(identity?: string | null): string | undefined {
  const normalized = identity?.trim().replace(/^0x/i, "")
  return normalized && /^[0-9a-f]{64}$/i.test(normalized)
    ? `lumiere:${normalized.toLowerCase()}`
    : undefined
}

const sdkProperties = [
  "distinct_id",
  "$anon_distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$process_person_profile",
  "$is_identified",
] as const

type AnalyticsProperty = EventProperty<keyof typeof eventProperties> | (typeof sdkProperties)[number]

function safeAnalyticsProperty(key: AnalyticsProperty, value: unknown): AnalyticsValue | undefined {
  if (key === "organization_id" || key === "company_id") {
    if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) return
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return
    const id = String(value)
    return /^[1-9][0-9]{0,19}$/.test(id) ? id : undefined
  }
  // These fields carry SDK-generated UUIDs or the authenticated ERP analytics identifier.
  if (
    key === "distinct_id" ||
    key === "$anon_distinct_id" ||
    key === "$device_id" ||
    key === "$session_id" ||
    key === "$window_id"
  ) {
    return typeof value === "string" &&
      /^(?:lumiere:[0-9a-f]{64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(value)
      ? value
      : undefined
  }
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value !== "string") return undefined
  if (key === "$pathname") return analyticsPage(value)
  // Caller-defined string fields are bounded enum/identifier tokens.
  return /^[a-z0-9_.:-]{1,96}$/i.test(value) ? value : undefined
}

type EventEnvelope = {
  event: string
  properties?: object
  $set?: unknown
  $set_once?: unknown
}

export function filterAnalyticsEvent<T extends EventEnvelope>(event: T): T | null {
  if (!Object.hasOwn(eventProperties, event.event)) return null
  const eventKeys = eventProperties[event.event as keyof typeof eventProperties]
  const properties: Partial<Record<AnalyticsProperty | "$geoip_disable", AnalyticsValue>> = {
    $geoip_disable: true,
  }
  for (const key of [...sdkProperties, ...eventKeys]) {
    const input: unknown =
      event.properties && Object.getOwnPropertyDescriptor(event.properties, key)?.value
    const value = safeAnalyticsProperty(key, input)
    if (value !== undefined) properties[key] = value
  }
  // SDK default properties include full URLs, referrers, and initial attribution.
  return { ...event, properties, $set: undefined, $set_once: undefined }
}
