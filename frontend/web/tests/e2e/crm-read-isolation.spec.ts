import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"

import {
  callReducerBff,
  fetchSessionOrganizationId,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { DbConnection } from "@lumiere/stdb/generated"
import { RESOURCE_REGISTRY as resourceRegistry } from "@lumiere/stdb/generated/query-registry"

const E2E_PASSWORD = "Password123$"
const none = { none: [] as [] }
const some = <T>(value: T) => ({ some: value })

type QueryRow = Record<string, unknown>

type TenantFixture = {
  context: BrowserContext
  page: Page
  branchContext: BrowserContext
  branchPage: Page
  organizationId: number
  mainCompanyId: number
  branchCompanyId: number
  mainContactName: string
  branchContactName: string
  mainCompanionName: string
  branchCompanionName: string
  sharedNames: Record<string, string>
}

type RealtimeMessage = {
  type?: string
  error?: string
  row?: unknown
  data?: unknown
  payload?: unknown
}

const CRM_RESOURCES = [
  "leads",
  "lead-sources",
  "lead-lost-reasons",
  "opportunities",
  "opportunity-stages",
  "opportunity-lines",
  "opportunity-presence",
  "contacts",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-tags",
  "contact-tag-assignments",
  "contact-segments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "assignment-rules",
  "activities",
  "calendar-events",
  "utm-campaigns",
  "utm-media",
  "utm-sources",
  "privacy-consent",
  "contact-communication-preferences",
  "crm-forecast-snapshots",
  "lead-scores",
  "lead-score-factors",
  "contact-segment-rules",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
] as const

// Complete private CRM storage inventory, including private supporting tables that do not have
// their own BFF resource. Keep synchronized with spacetimedb/src/crm/mod.rs::privacy_tests.
const PRIVATE_CRM_TABLES = [
  "activity",
  "activity_type",
  "calendar_event",
  "contact_phone_identity",
  "contact_identity_verification_proof",
  "contact_identity_verification_authority",
  "contact_role_assignment",
  "contact",
  "contact_category",
  "contact_category_assignment",
  "contact_relationship",
  "contact_tag",
  "contact_tag_assignment",
  "contact_duplicate_candidate",
  "crm_forecast_snapshot",
  "crm_conversation",
  "crm_conversation_message",
  "crm_provider_principal",
  "crm_provider_event_receipt",
  "lead_score",
  "lead_score_factor",
  "lead",
  "lead_source",
  "lead_lost_reason",
  "opportunity",
  "opp_stage",
  "opportunity_line",
  "opportunity_presence",
  "contact_relationship_insight",
  "contact_segment",
  "segment_member",
  "assignment_rule",
  "contact_segment_rule",
  "privacy_consent",
  "contact_communication_preference",
  "utm_campaign",
  "utm_medium",
  "utm_source",
] as const

const ORGANIZATION_SHARED_CRM_RESOURCES = [
  "leads",
  "lead-sources",
  "lead-lost-reasons",
  "opportunity-stages",
  "contact-tags",
  "contact-segments",
  "assignment-rules",
  "activities",
  "calendar-events",
  "utm-campaigns",
  "utm-media",
  "utm-sources",
  "lead-scores",
  "lead-score-factors",
  "contact-segment-rules",
] as const

const COMPANY_SCOPED_CRM_RESOURCES = [
  "opportunities",
  "opportunity-lines",
  "opportunity-presence",
  "contacts",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-tag-assignments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "privacy-consent",
  "contact-communication-preferences",
  "crm-forecast-snapshots",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
] as const

const BOUNDARY_ONLY_CRM_RESOURCES = new Set<string>([
  "opportunity-lines",
  // HTTP reducer calls disconnect immediately, and the module intentionally
  // deletes presence rows on disconnect. Live scope is covered by the bridge.
  "opportunity-presence",
  "contact-duplicate-candidates",
  "crm-conversations",
  "crm-conversation-messages",
])

function e2eBaseUrl() {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
}

function realtimeUrl() {
  const base = process.env.LUMIERE_API_SERVER_URL ?? "http://127.0.0.1:8082"
  const url = new URL("/v1/realtime/ws", base)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function valueAsId(row: QueryRow, ...keys: string[]): number | null {
  for (const key of keys) {
    const id = scalarQueryId(row[key])
    if (id != null) return id
  }
  return null
}

function valueAsString(row: QueryRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value != null) return String(value)
  }
  return ""
}

async function queryRows(page: Page, path: string): Promise<QueryRow[]> {
  const response = await page.request.get(path)
  if (!response.ok()) {
    throw new Error(`${path} failed: ${response.status()} ${await response.text()}`)
  }
  const payload = (await response.json()) as { data?: QueryRow[] }
  return payload.data ?? []
}

async function queryCrmResourceMatrix(page: Page, companyId: number) {
  const matrix = new Map<string, QueryRow[]>()
  for (const resource of CRM_RESOURCES) {
    matrix.set(resource, await queryRows(page, `/api/query/${resource}?companyId=${companyId}`))
  }
  return matrix
}

function sortedIds(rows: QueryRow[] | undefined) {
  return (rows ?? [])
    .map((row) => valueAsId(row, "id"))
    .filter((id): id is number => id != null)
    .sort((a, b) => a - b)
}

function expectRowsWithinScope(rows: QueryRow[], organizationId: number, companyId: number) {
  for (const row of rows) {
    const rowOrganizationId = valueAsId(row, "organizationId", "organization_id")
    if (rowOrganizationId != null) expect(rowOrganizationId).toBe(organizationId)
    const rowCompanyId = valueAsId(row, "companyId", "company_id")
    if (rowCompanyId != null) expect(rowCompanyId).toBe(companyId)
  }
}

async function waitForRow(
  page: Page,
  path: string,
  predicate: (row: QueryRow) => boolean,
  description: string,
): Promise<QueryRow> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const row = (await queryRows(page, path)).find(predicate)
    if (row) return row
    await page.waitForTimeout(200)
  }
  throw new Error(`timed out waiting for ${description}`)
}

function contactParams(name: string, companyId: number) {
  return {
    name,
    type: "contact",
    email: some(`${name}@example.test`),
    phone: none,
    mobile: none,
    company_id: some(companyId),
    is_customer: true,
    is_vendor: false,
    is_employee: false,
    is_prospect: false,
    is_partner: false,
    customer_rank: 17,
    supplier_rank: 0,
    display_name: none,
    first_name: none,
    last_name: none,
    title: none,
    email_secondary: none,
    fax: none,
    website: none,
    street: none,
    street2: none,
    city: none,
    state_code: none,
    zip: none,
    country_code: some("US"),
    tax_id: none,
    company_registry: none,
    industry: none,
    employees_count: none,
    annual_revenue: none,
    description: none,
    salesperson_id: none,
    assigned_user_id: none,
    parent_id: none,
    user_id: none,
    color: none,
    metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
  }
}

async function bootstrapTenant(browser: Browser, label: string): Promise<TenantFixture> {
  const suffix = smokeName(`crm-isolation-${label}`)
  const organizationCode = `CI${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const api = await playwrightRequest.newContext({ baseURL: e2eBaseUrl() })
  let context: BrowserContext | undefined
  let branchContext: BrowserContext | undefined

  try {
    const signup = await api.post("/api/auth/signup", {
      data: { email: `${suffix}@example.test`, password: E2E_PASSWORD },
    })
    if (!signup.ok()) {
      throw new Error(`tenant signup failed (${signup.status()}): ${await signup.text()}`)
    }

    const currenciesResponse = await api.get("/api/bootstrap/currencies")
    if (!currenciesResponse.ok()) {
      throw new Error(
        `currency catalog failed (${currenciesResponse.status()}): ${await currenciesResponse.text()}`,
      )
    }
    const currencies = (await currenciesResponse.json()) as { data?: QueryRow[] }
    const currencyCode = valueAsString(currencies.data?.[0] ?? {}, "code")
    if (!currencyCode) throw new Error("bootstrap currency catalog is empty")

    const mainCompanyName = `${suffix} main`
    const bootstrap = await api.post("/api/bootstrap/tenant", {
      data: {
        organization: {
          name: `${suffix} organization`,
          code: organizationCode,
          timezone: "UTC",
          dateFormat: "YYYY-MM-DD",
          language: "en",
          isActive: true,
          description: null,
          logoUrl: null,
          website: null,
          email: null,
          phone: null,
          currencyId: null,
          metadata: JSON.stringify({ fixture: "CRM-RI-007-live-isolation", label }),
        },
        defaultCompanyName: mainCompanyName,
        defaultCompanyCode: `${organizationCode}M`,
        defaultCompanyCurrencyId: 0,
        defaultCompanyCurrencyCode: currencyCode,
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        seedFormConfigs: false,
        settings: {
          moduleConfig: null,
          featureFlags: ["crm_multi_company"],
          integrationKeys: null,
          metadata: JSON.stringify({ fixture: "CRM-RI-007-live-isolation" }),
        },
      },
    })
    if (!bootstrap.ok()) {
      throw new Error(`tenant bootstrap failed (${bootstrap.status()}): ${await bootstrap.text()}`)
    }

    context = await browser.newContext({
      baseURL: e2eBaseUrl(),
      storageState: await api.storageState(),
    })
    const page = await context.newPage()
    await page.goto("/")
    const organizationId = await fetchSessionOrganizationId(page)
    const mainCompany = await waitForRow(
      page,
      "/api/query/companies",
      (row) => valueAsString(row, "name") === mainCompanyName,
      `${label} main company`,
    )
    const mainCompanyId = valueAsId(mainCompany, "id")
    const currencyId = valueAsId(mainCompany, "currencyId", "currency_id")
    if (mainCompanyId == null || currencyId == null) {
      throw new Error(`${label} main company has no id or currency`)
    }

    const branchCompanyName = `${suffix} branch`
    await callReducerBff(page, "create_company", [
      organizationId,
      {
        name: branchCompanyName,
        code: `${organizationCode}B`,
        currency_id: currencyId,
        fiscal_year_end_month: 12,
        fiscal_year_end_day: 31,
        is_parent: false,
        parent_id: some(mainCompanyId),
        tax_id: none,
        company_registry: none,
        address_street: none,
        address_city: none,
        address_zip: none,
        address_country_code: some("US"),
        metadata: some(
          JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope: "branch" }),
        ),
      },
    ])
    const branchCompany = await waitForRow(
      page,
      "/api/query/companies",
      (row) => valueAsString(row, "name") === branchCompanyName,
      `${label} branch company`,
    )
    const branchCompanyId = valueAsId(branchCompany, "id")
    if (branchCompanyId == null) throw new Error(`${label} branch company has no id`)

    const mainContactName = `${suffix}-main-contact`
    const branchContactName = `${suffix}-branch-contact`
    const mainCompanionName = `${suffix}-main-companion`
    const branchCompanionName = `${suffix}-branch-companion`
    await callReducerBff(page, "create_contact", [
      organizationId,
      contactParams(mainContactName, mainCompanyId),
    ])
    await callReducerBff(page, "create_contact", [
      organizationId,
      contactParams(branchContactName, branchCompanyId),
    ])
    await callReducerBff(page, "create_contact", [
      organizationId,
      contactParams(mainCompanionName, mainCompanyId),
    ])
    await callReducerBff(page, "create_contact", [
      organizationId,
      contactParams(branchCompanionName, branchCompanyId),
    ])

    const sharedNames = {
      leads: `${suffix}-ORG_${label.toUpperCase()}_SHARED-lead`,
      "lead-sources": `${suffix}-shared-lead-source`,
      "lead-lost-reasons": `${suffix}-shared-lost-reason`,
      "opportunity-stages": `${suffix}-shared-stage`,
      "contact-tags": `${suffix}-shared-tag`,
      "contact-segments": `${suffix}-shared-segment`,
      "assignment-rules": `${suffix}-shared-assignment-rule`,
      activities: `${suffix}-shared-activity`,
      "calendar-events": `${suffix}-shared-calendar-event`,
      "utm-campaigns": `${suffix}-shared-campaign`,
      "utm-media": `${suffix}-shared-medium`,
      "utm-sources": `${suffix}-shared-utm-source`,
    }
    await callReducerBff(page, "create_lead_source", [
      organizationId,
      {
        name: sharedNames["lead-sources"],
        description: some("organization-shared CRM-RI-007 fixture"),
        sequence: 707,
        is_active: true,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "create_lead_lost_reason", [
      organizationId,
      {
        name: sharedNames["lead-lost-reasons"],
        description: some("organization-shared CRM-RI-007 fixture"),
        is_active: true,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "create_contact_tag", [
      organizationId,
      {
        name: sharedNames["contact-tags"],
        color: some("#707070"),
        description: some("organization-shared CRM-RI-007 fixture"),
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "create_contact_segment", [
      organizationId,
      {
        name: sharedNames["contact-segments"],
        is_dynamic: true,
        is_active: true,
        description: some("organization-shared CRM-RI-007 fixture"),
        domain: none,
        color: some("#707070"),
        parent_id: none,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    for (const [reducer, resource] of [
      ["create_utm_campaign", "utm-campaigns"],
      ["create_utm_medium", "utm-media"],
      ["create_utm_source", "utm-sources"],
    ] as const) {
      await callReducerBff(page, reducer, [
        organizationId,
        { name: sharedNames[resource], is_active: true },
      ])
    }
    await callReducerBff(page, "create_opportunity_stage", [
      organizationId,
      {
        name: sharedNames["opportunity-stages"],
        sequence: 707,
        probability: 35,
        requirements: none,
        fold: false,
        is_won: false,
        team_id: none,
        is_active: true,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "create_assignment_rule", [
      organizationId,
      {
        name: sharedNames["assignment-rules"],
        model: "contact",
        domain: some("country_code = US"),
        assign_type: "round_robin",
        user_ids: [],
        team_id: none,
        priority: 707,
        is_active: true,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    const nowMicros = Date.now() * 1_000
    const activityTypes = await ownerSql(
      `SELECT id FROM activity_type WHERE organization_id = ${organizationId}`,
    )
    const activityTypeId = valueAsId(activityTypes[0] ?? {}, "id")
    if (activityTypeId == null) throw new Error(`${label} activity type has no id`)
    await callReducerBff(page, "create_activity", [
      organizationId,
      {
        activity_type_id: activityTypeId,
        summary: sharedNames.activities,
        priority: "1",
        state: "planned",
        auto: false,
        is_system: false,
        is_done: false,
        note: none,
        date_deadline: none,
        date_done: none,
        assigned_to: none,
        target: none,
        duration: some(15),
        location: none,
        video_url: none,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "create_calendar_event", [
      organizationId,
      {
        name: sharedNames["calendar-events"],
        start: { __timestamp_micros_since_unix_epoch__: nowMicros },
        stop: { __timestamp_micros_since_unix_epoch__: nowMicros + 3_600_000_000 },
        allday: false,
        privacy: "private",
        show_as: "busy",
        state: "open",
        recurrency: false,
        partner_ids: [],
        alarm_ids: [],
        user_id: none,
        description: none,
        location: none,
        videocall_location: none,
        color: none,
        recurrence_id: none,
        rrule: none,
        rrule_type: none,
        final_date: none,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])

    const [mainContact, branchContact, mainCompanion, branchCompanion] = await ownerSql(
      `SELECT id, name FROM contact WHERE organization_id = ${organizationId}`,
    ).then((rows) => [
      rows.find((row) => valueAsString(row, "name") === mainContactName),
      rows.find((row) => valueAsString(row, "name") === branchContactName),
      rows.find((row) => valueAsString(row, "name") === mainCompanionName),
      rows.find((row) => valueAsString(row, "name") === branchCompanionName),
    ])
    const tag = await waitForRow(
      page,
      `/api/query/contact-tags?companyId=${mainCompanyId}`,
      (row) => valueAsString(row, "name") === sharedNames["contact-tags"],
      `${label} shared tag`,
    )
    const segment = await waitForRow(
      page,
      `/api/query/contact-segments?companyId=${mainCompanyId}`,
      (row) => valueAsString(row, "name") === sharedNames["contact-segments"],
      `${label} shared segment`,
    )
    const mainContactId = valueAsId(mainContact ?? {}, "id")
    const branchContactId = valueAsId(branchContact ?? {}, "id")
    const mainCompanionId = valueAsId(mainCompanion ?? {}, "id")
    const branchCompanionId = valueAsId(branchCompanion ?? {}, "id")
    const tagId = valueAsId(tag, "id")
    const segmentId = valueAsId(segment, "id")
    if (
      mainContactId == null ||
      branchContactId == null ||
      mainCompanionId == null ||
      branchCompanionId == null ||
      tagId == null ||
      segmentId == null
    ) {
      throw new Error(`${label} CRM relationship fixture IDs are incomplete`)
    }
    const sharedId = async (resource: keyof typeof sharedNames) => {
      const row = await waitForRow(
        page,
        `/api/query/${resource}?companyId=${mainCompanyId}`,
        (candidate) => valueAsString(candidate, "name", "summary") === sharedNames[resource],
        `${label} ${resource} fixture`,
      )
      const id = valueAsId(row, "id")
      if (id == null) throw new Error(`${label} ${resource} fixture has no id`)
      return id
    }
    const sourceId = await sharedId("lead-sources")
    const campaignId = await sharedId("utm-campaigns")
    const mediumId = await sharedId("utm-media")
    await callReducerBff(page, "create_lead", [
      organizationId,
      {
        name: sharedNames.leads,
        priority: "2",
        state: "qualified",
        expected_revenue: 707,
        probability: 35,
        tag_ids: [tagId],
        email: some(`${suffix}-shared-lead@example.test`),
        phone: none,
        mobile: none,
        company_name: some(`${suffix} shared prospect`),
        contact_name: none,
        title: none,
        street: none,
        city: some("Matrix City"),
        zip: none,
        country_code: some("US"),
        website: none,
        industry: some("matrix-testing"),
        source_id: some(sourceId),
        campaign_id: some(campaignId),
        medium_id: some(mediumId),
        referred_by: none,
        description: some("organization-shared CRM-RI-007 fixture"),
        user_id: none,
        stage_id: none,
        team_id: none,
        partner_id: none,
        date_deadline: none,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    const leadId = await sharedId("leads")
    await callReducerBff(page, "recompute_lead_score", [organizationId, leadId])
    await callReducerBff(page, "set_contact_segment_rules", [
      organizationId,
      segmentId,
      {
        replace_all: true,
        rules: [
          {
            field: { countryCode: [] },
            op: { eq: [] },
            value_text: some("US"),
            value_id: none,
          },
        ],
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])
    await callReducerBff(page, "evaluate_dynamic_segment", [organizationId, segmentId])
    const stageId = await sharedId("opportunity-stages")
    const mainScope = label === "alpha" ? "A1" : "B1"
    const branchScope = label === "alpha" ? "A2" : "B2"
    for (const [scope, contactId, companionId, companyId, phoneSuffix] of [
      [mainScope, mainContactId, mainCompanionId, mainCompanyId, label === "alpha" ? "701" : "703"],
      [branchScope, branchContactId, branchCompanionId, branchCompanyId, label === "alpha" ? "702" : "704"],
    ] as const) {
      await callReducerBff(page, "assign_tag_to_contact", [
        organizationId,
        contactId,
        tagId,
        some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      ])
      await callReducerBff(page, "create_contact_identity", [
        organizationId,
        {
          kind: { primary: [] },
          verification_state: none,
          contact_id: contactId,
          company_id: some(companyId),
          raw_value: `+14155550${phoneSuffix}`,
          is_preferred: true,
          metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope })),
        },
      ])
      await callReducerBff(page, "assign_contact_role", [
        organizationId,
        {
          contact_id: contactId,
          company_id: some(companyId),
          role: "customer",
          active_from: none,
          active_until: none,
          metadata: some(some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope }))),
        },
      ])
      await callReducerBff(page, "record_privacy_consent", [
        organizationId,
        {
          contact_id: contactId,
          consent_type: `crm-ri007-${scope.toLowerCase()}`,
          granted: true,
          ip_address: none,
          user_agent: some("crm-read-isolation.spec.ts"),
          metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope })),
        },
      ])
      await callReducerBff(page, "set_contact_communication_preference", [
        organizationId,
        some(companyId),
        contactId,
        { sms: [] },
        true,
      ])
      await callReducerBff(page, "create_contact_relationship", [
        organizationId,
        {
          left_contact_id: contactId,
          right_contact_id: companionId,
          relationship_type: "partner",
          start_date: none,
          notes: some(`CRM-RI-007 ${scope} relationship`),
          metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope })),
        },
      ])
      await callReducerBff(page, "recompute_relationship_insights", [organizationId, contactId])
      await callReducerBff(page, "create_opportunity", [
        organizationId,
        {
          name: `${suffix}-${scope}_ONLY-opportunity`,
          expected_revenue: scope === "A1" ? 7_071 : 7_072,
          probability: 35,
          stage_id: stageId,
          priority: "2",
          is_won: false,
          is_lost: false,
          tag_ids: [tagId],
          lead_id: none,
          partner_id: none,
          contact_id: some(contactId),
          campaign_id: some(campaignId),
          medium_id: some(mediumId),
          source_id: some(sourceId),
          user_id: none,
          team_id: none,
          company_id: some(companyId),
          company_currency_id: some(currencyId),
          lost_reason_id: none,
          date_open: none,
          date_closed: none,
          date_deadline: none,
          date_last_stage_update: none,
          day_open: none,
          day_close: none,
          color: none,
          description: some(`CRM-RI-007 ${scope} opportunity`),
          metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope })),
        },
      ])
      const opportunity = await ownerSql(
        `SELECT id, name FROM opportunity WHERE organization_id = ${organizationId}`,
      ).then((rows) =>
        rows.find((row) => valueAsString(row, "name") === `${suffix}-${scope}_ONLY-opportunity`),
      )
      const opportunityId = valueAsId(opportunity ?? {}, "id")
      if (opportunityId == null) throw new Error(`${label} ${scope} opportunity has no id`)
      // CRM-RI-017: the display name is now derived server-side from the
      // authenticated user's profile and is no longer a reducer argument.
      await callReducerBff(page, "update_opportunity_presence", [
        organizationId,
        opportunityId,
      ])
      await callReducerBff(page, "create_forecast_snapshot", [
        organizationId,
        companyId,
        {
          period_start: { __timestamp_micros_since_unix_epoch__: nowMicros },
          period_end: { __timestamp_micros_since_unix_epoch__: nowMicros + 86_400_000_000 },
          owner_id: none,
          metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope })),
        },
      ])
    }

    const branchRoleName = `${suffix}-crm-reader`
    await callReducerBff(page, "create_role", [
      organizationId,
      {
        name: branchRoleName,
        description: some("ephemeral company-bound CRM isolation reader"),
        parent_id: none,
        permissions: ["contact:read", "contact_identity:read"],
        is_active: true,
        metadata: some(JSON.stringify({ fixture: "CRM-RI-007-live-isolation" })),
      },
    ])

    const branchEmail = `${smokeName(`crm-isolation-${label}-branch-user`)}@example.test`
    const branchSignup = await playwrightRequest.newContext({ baseURL: e2eBaseUrl() })
    let branchIdentityHex: string
    try {
      const signupResponse = await branchSignup.post("/api/auth/signup", {
        data: { email: branchEmail, password: E2E_PASSWORD },
      })
      if (!signupResponse.ok()) {
        throw new Error(
          `branch user signup failed (${signupResponse.status()}): ${await signupResponse.text()}`,
        )
      }
      const state = await branchSignup.storageState()
      const identity = state.cookies.find((cookie) => cookie.name === "stdb_identity")?.value
      if (!identity) throw new Error("branch user signup did not set stdb_identity")
      branchIdentityHex = identity.replace(/^0x/i, "")
    } finally {
      await branchSignup.dispose()
    }

    await callReducerBff(page, "add_org_member", [
      branchIdentityHex,
      organizationId,
      {
        role_name: branchRoleName,
        company_id: some(branchCompanyId),
        job_title: none,
        department_id: none,
        employee_id: none,
        is_active: true,
        is_default: true,
        metadata: some(
          JSON.stringify({ fixture: "CRM-RI-007-live-isolation", scope: "branch" }),
        ),
      },
    ])

    branchContext = await browser.newContext({ baseURL: e2eBaseUrl() })
    const branchPage = await branchContext.newPage()
    await signIn(branchPage, branchEmail, E2E_PASSWORD)

    return {
      context,
      page,
      branchContext,
      branchPage,
      organizationId,
      mainCompanyId,
      branchCompanyId,
      mainContactName,
      branchContactName,
      mainCompanionName,
      branchCompanionName,
      sharedNames,
    }
  } catch (error) {
    await branchContext?.close()
    await context?.close()
    throw error
  } finally {
    await api.dispose()
  }
}

function sqlElementName(element: unknown) {
  if (element == null || typeof element !== "object") return ""
  const name = (element as { name?: unknown }).name
  if (typeof name === "string") return name
  if (name != null && typeof name === "object" && "some" in name) {
    return String((name as { some: unknown }).some)
  }
  return ""
}

function unwrapSats(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return unwrapSats((value as { some: unknown }).some)
    if ("none" in value) return undefined
  }
  return value
}

async function ownerSql(sql: string): Promise<QueryRow[]> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  )
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) {
    throw new Error("live CRM isolation test requires STDB_MODULE and STDB_SERVER_TOKEN")
  }
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: sql,
  })
  if (!response.ok) {
    throw new Error(`owner SQL failed (${response.status}): ${await response.text()}`)
  }
  const resultSets = (await response.json()) as Array<{
    schema?: { elements?: unknown[] }
    rows?: unknown[][]
  }>
  const first = resultSets[0]
  const elements = first?.schema?.elements ?? []
  return (first?.rows ?? []).map((values) =>
    Object.fromEntries(
      elements.map((element, index) => [sqlElementName(element), unwrapSats(values[index])]),
    ),
  )
}

async function ordinaryTokenForPage(page: Page) {
  const state = await page.context().storageState()
  const token = state.cookies.find((cookie) => cookie.name === "stdb_token")?.value
  if (!token) throw new Error("authenticated session has no stdb_token cookie")
  return token
}

async function privateSqlStatusesForPage(page: Page) {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  )
  const moduleName = process.env.STDB_MODULE?.trim()
  if (!moduleName) throw new Error("live CRM isolation test requires STDB_MODULE")
  const token = await ordinaryTokenForPage(page)
  return Promise.all(
    PRIVATE_CRM_TABLES.map(async (table) => {
      const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        body: `SELECT id FROM ${table} LIMIT 1`,
      })
      return { table, status: response.status }
    }),
  )
}

async function privateSubscriptionResultsForPage(page: Page) {
  const host = process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000"
  const moduleName = process.env.STDB_MODULE?.trim()
  if (!moduleName) throw new Error("live CRM isolation test requires STDB_MODULE")
  const token = await ordinaryTokenForPage(page)

  return new Promise<Array<{ table: string; result: "denied" | "applied"; deliveredRows: number }>>(
    (resolve, reject) => {
    let connection: DbConnection | undefined
    const timeout = setTimeout(() => {
      connection?.disconnect()
      reject(new Error("direct private-table subscription matrix timed out"))
    }, 30_000)

    connection = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(moduleName)
      .withToken(token)
      .onConnect((connected) => {
        const deliveredRows = new Map<string, number>()
        const database = connected.db as unknown as Record<
          string,
          { onInsert?: (callback: () => void) => void }
        >
        for (const table of PRIVATE_CRM_TABLES) {
          deliveredRows.set(table, 0)
          const accessor = table.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())
          database[accessor]?.onInsert?.(() => {
            deliveredRows.set(table, (deliveredRows.get(table) ?? 0) + 1)
          })
        }

        const results: Array<{
          table: string
          result: "denied" | "applied"
          deliveredRows: number
        }> = []
        const finish = (table: string, result: "denied" | "applied") => {
          results.push({ table, result, deliveredRows: deliveredRows.get(table) ?? 0 })
          if (results.length !== PRIVATE_CRM_TABLES.length) return
          clearTimeout(timeout)
          connected.disconnect()
          resolve(results)
        }

        for (const table of PRIVATE_CRM_TABLES) {
          connected
            .subscriptionBuilder()
            .onApplied(() => finish(table, "applied"))
            .onError(() => finish(table, "denied"))
            .subscribe(`SELECT * FROM ${table}`)
        }
      })
      .onConnectError((_context, error) => {
        clearTimeout(timeout)
        reject(new Error(`direct subscription connection failed: ${String(error)}`))
      })
      .build()
    },
  )
}

async function realtimeSubscribe(page: Page, payload: Record<string, unknown>) {
  return page.evaluate(
    ({ url, subscription }) =>
      new Promise<RealtimeMessage>((resolve, reject) => {
        const socket = new WebSocket(url)
        const timeout = window.setTimeout(() => {
          socket.close()
          reject(new Error("realtime subscription timed out"))
        }, 30_000)
        socket.onopen = () => socket.send(JSON.stringify(subscription))
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return
          const message = JSON.parse(event.data) as RealtimeMessage
          if (message.type !== "subscribed" && message.type !== "error") return
          window.clearTimeout(timeout)
          socket.close()
          resolve(message)
        }
        socket.onerror = () => {
          window.clearTimeout(timeout)
          reject(new Error("realtime WebSocket failed"))
        }
      }),
    { url: realtimeUrl(), subscription: payload },
  )
}

async function waitForRealtimeChange(
  page: Page,
  payload: Record<string, unknown>,
  mutate: () => Promise<void>,
) {
  const readyKey = `__crmIsolationReady${Math.random().toString(36).slice(2)}`
  const change = page.evaluate(
    ({ url, subscription, key }) =>
      new Promise<RealtimeMessage>((resolve, reject) => {
        const state = window as typeof window & Record<string, unknown>
        const socket = new WebSocket(url)
        const timeout = window.setTimeout(() => {
          socket.close()
          reject(new Error("realtime change timed out"))
        }, 30_000)
        socket.onopen = () => socket.send(JSON.stringify(subscription))
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return
          const message = JSON.parse(event.data) as RealtimeMessage
          if (message.type === "subscribed") {
            state[key] = true
            return
          }
          if (message.type !== "change" && message.type !== "error") return
          window.clearTimeout(timeout)
          socket.close()
          resolve(message)
        }
        socket.onerror = () => {
          window.clearTimeout(timeout)
          reject(new Error("realtime WebSocket failed"))
        }
      }),
    { url: realtimeUrl(), subscription: payload, key: readyKey },
  )
  await page.waitForFunction((key) => Boolean((window as typeof window & Record<string, unknown>)[key]), readyKey)
  await mutate()
  return change
}

async function expectNoRealtimeChange(
  page: Page,
  payload: Record<string, unknown>,
  mutate: () => Promise<void>,
) {
  const readyKey = `__crmIsolationQuietReady${Math.random().toString(36).slice(2)}`
  const observation = page.evaluate(
    ({ url, subscription, key }) =>
      new Promise<RealtimeMessage>((resolve, reject) => {
        const state = window as typeof window & Record<string, unknown>
        const socket = new WebSocket(url)
        const timeout = window.setTimeout(() => {
          socket.close()
          resolve({ type: "quiet" })
        }, 2_000)
        socket.onopen = () => socket.send(JSON.stringify(subscription))
        socket.onmessage = (event) => {
          if (typeof event.data !== "string") return
          const message = JSON.parse(event.data) as RealtimeMessage
          if (message.type === "subscribed") {
            state[key] = true
            return
          }
          if (message.type !== "change" && message.type !== "error") return
          window.clearTimeout(timeout)
          socket.close()
          resolve(message)
        }
        socket.onerror = () => {
          window.clearTimeout(timeout)
          reject(new Error("realtime quiet observer failed"))
        }
      }),
    { url: realtimeUrl(), subscription: payload, key: readyKey },
  )
  await page.waitForFunction(
    (key) => Boolean((window as typeof window & Record<string, unknown>)[key]),
    readyKey,
  )
  await mutate()
  const result = await observation
  expect(result.type, JSON.stringify(result)).toBe("quiet")
}

test.describe("CRM authenticated read isolation", { tag: ["@p0", "@crm"] }, () => {
  test("keeps the live authorization inventories aligned with the canonical registry", () => {
    const registry = resourceRegistry as Record<string, { table?: string }>
    expect(CRM_RESOURCES).toHaveLength(31)
    expect(PRIVATE_CRM_TABLES).toHaveLength(38)
    expect(ORGANIZATION_SHARED_CRM_RESOURCES).toHaveLength(15)
    expect(COMPANY_SCOPED_CRM_RESOURCES).toHaveLength(16)
    expect(
      new Set([...ORGANIZATION_SHARED_CRM_RESOURCES, ...COMPANY_SCOPED_CRM_RESOURCES]),
    ).toEqual(new Set(CRM_RESOURCES))
    for (const resource of CRM_RESOURCES) {
      const table = registry[resource]?.table
      expect(table, `${resource} must remain registered`).toBeTruthy()
      expect(PRIVATE_CRM_TABLES, `${resource} must resolve to private storage`).toContain(table)
    }
  })

  test("isolates persisted contacts across two organizations and companies", async ({ browser }) => {
    test.setTimeout(300_000)

    const alpha = await bootstrapTenant(browser, "alpha")
    const beta = await bootstrapTenant(browser, "beta")

    try {
      const fixtureNames = new Set([
        alpha.mainContactName,
        alpha.branchContactName,
        alpha.mainCompanionName,
        alpha.branchCompanionName,
        beta.mainContactName,
        beta.branchContactName,
        beta.mainCompanionName,
        beta.branchCompanionName,
      ])
      const persisted = [
        ...(await ownerSql(
          `SELECT id, organization_id, company_id, name FROM contact WHERE organization_id = ${alpha.organizationId}`,
        )),
        ...(await ownerSql(
          `SELECT id, organization_id, company_id, name FROM contact WHERE organization_id = ${beta.organizationId}`,
        )),
      ].filter((row) => fixtureNames.has(valueAsString(row, "name")))
      expect(persisted).toHaveLength(8)

      const alphaOwn = await queryRows(
        alpha.page,
        `/api/query/contacts?companyId=${alpha.mainCompanyId}`,
      )
      expect(alphaOwn.some((row) => valueAsString(row, "name") === alpha.mainContactName)).toBe(true)
      expect(alphaOwn.some((row) => valueAsString(row, "name") === alpha.branchContactName)).toBe(false)
      expect(alphaOwn.some((row) => valueAsString(row, "name") === beta.mainContactName)).toBe(false)

      const alphaBranchOwn = await queryRows(
        alpha.branchPage,
        `/api/query/contacts?companyId=${alpha.branchCompanyId}`,
      )
      expect(
        alphaBranchOwn.some((row) => valueAsString(row, "name") === alpha.branchContactName),
      ).toBe(true)
      expect(
        alphaBranchOwn.some((row) => valueAsString(row, "name") === alpha.mainContactName),
      ).toBe(false)

      const betaOwn = await queryRows(
        beta.page,
        `/api/query/contacts?companyId=${beta.mainCompanyId}`,
      )
      expect(betaOwn.some((row) => valueAsString(row, "name") === beta.mainContactName)).toBe(true)
      expect(betaOwn.some((row) => valueAsString(row, "name") === beta.branchContactName)).toBe(false)
      expect(betaOwn.some((row) => valueAsString(row, "name") === alpha.mainContactName)).toBe(false)

      const crossCompanyQuery = await alpha.page.request.get(
        `/api/query/contacts?companyId=${alpha.branchCompanyId}`,
      )
      expect(crossCompanyQuery.status()).toBe(403)

      const branchToMainQuery = await alpha.branchPage.request.get(
        `/api/query/contacts?companyId=${alpha.mainCompanyId}`,
      )
      expect(branchToMainQuery.status()).toBe(403)

      const crossOrganizationQuery = await alpha.page.request.get(
        `/api/query/contacts?organizationId=${beta.organizationId}`,
      )
      expect(crossOrganizationQuery.status()).toBe(403)

      const alphaMainMatrix = await queryCrmResourceMatrix(alpha.page, alpha.mainCompanyId)
      const alphaBranchMatrix = await queryCrmResourceMatrix(
        alpha.branchPage,
        alpha.branchCompanyId,
      )
      const betaMainMatrix = await queryCrmResourceMatrix(beta.page, beta.mainCompanyId)
      for (const resource of CRM_RESOURCES) {
        expectRowsWithinScope(
          alphaMainMatrix.get(resource) ?? [],
          alpha.organizationId,
          alpha.mainCompanyId,
        )
        expectRowsWithinScope(
          alphaBranchMatrix.get(resource) ?? [],
          alpha.organizationId,
          alpha.branchCompanyId,
        )
        expectRowsWithinScope(
          betaMainMatrix.get(resource) ?? [],
          beta.organizationId,
          beta.mainCompanyId,
        )
      }
      for (const resource of ORGANIZATION_SHARED_CRM_RESOURCES) {
        expect(sortedIds(alphaMainMatrix.get(resource)), `${resource} A org-shared fixture`).not.toHaveLength(0)
        expect(sortedIds(alphaMainMatrix.get(resource))).toEqual(
          sortedIds(alphaBranchMatrix.get(resource)),
        )
      }
      for (const resource of COMPANY_SCOPED_CRM_RESOURCES) {
        if (BOUNDARY_ONLY_CRM_RESOURCES.has(resource)) continue
        const mainIds = sortedIds(alphaMainMatrix.get(resource))
        const branchIds = sortedIds(alphaBranchMatrix.get(resource))
        const betaIds = sortedIds(betaMainMatrix.get(resource))
        expect(mainIds, `${resource} A1 positive fixture`).not.toHaveLength(0)
        expect(branchIds, `${resource} A2 positive fixture`).not.toHaveLength(0)
        expect(betaIds, `${resource} B1 positive fixture`).not.toHaveLength(0)
        expect(mainIds.filter((id) => branchIds.includes(id)), `${resource} A1/A2 overlap`).toEqual([])
        expect(mainIds.filter((id) => betaIds.includes(id)), `${resource} A1/B1 overlap`).toEqual([])
      }
      for (const [resource, name] of Object.entries(alpha.sharedNames)) {
        const mainRows = alphaMainMatrix.get(resource) ?? []
        const branchRows = alphaBranchMatrix.get(resource) ?? []
        expect(
          mainRows.filter((row) => valueAsString(row, "name", "summary") === name),
        ).toHaveLength(1)
        expect(
          branchRows.filter((row) => valueAsString(row, "name", "summary") === name),
        ).toHaveLength(1)
        expect(
          (betaMainMatrix.get(resource) ?? []).some(
            (row) => valueAsString(row, "name", "summary") === name,
          ),
        ).toBe(false)
      }
      const fixtureContactId = (name: string) =>
        valueAsId(persisted.find((row) => valueAsString(row, "name") === name) ?? {}, "id")
      const alphaMainContactId = fixtureContactId(alpha.mainContactName)
      const alphaBranchContactId = fixtureContactId(alpha.branchContactName)
      expect(alphaMainContactId).not.toBeNull()
      expect(alphaBranchContactId).not.toBeNull()
      for (const resource of ["contact-tag-assignments", "segment-members"] as const) {
        const mainFixtureRows = (alphaMainMatrix.get(resource) ?? []).filter(
          (row) => valueAsId(row, "contactId", "contact_id") === alphaMainContactId,
        )
        const branchFixtureRows = (alphaBranchMatrix.get(resource) ?? []).filter(
          (row) => valueAsId(row, "contactId", "contact_id") === alphaBranchContactId,
        )
        expect(mainFixtureRows, `${resource} A1 exact parent-owned fixture`).toHaveLength(1)
        expect(branchFixtureRows, `${resource} A2 exact parent-owned fixture`).toHaveLength(1)
        expect(
          (alphaMainMatrix.get(resource) ?? []).some(
            (row) => valueAsId(row, "contactId", "contact_id") === alphaBranchContactId,
          ),
          `${resource} A1 must exclude A2`,
        ).toBe(false)
        expect(
          (alphaBranchMatrix.get(resource) ?? []).some(
            (row) => valueAsId(row, "contactId", "contact_id") === alphaMainContactId,
          ),
          `${resource} A2 must exclude A1`,
        ).toBe(false)
      }

      const privateSqlResults = await privateSqlStatusesForPage(alpha.branchPage)
      expect(privateSqlResults).toHaveLength(PRIVATE_CRM_TABLES.length)
      for (const result of privateSqlResults) {
        expect(result.status, `${result.table} direct SQL must be denied`).toBeGreaterThanOrEqual(400)
        expect(result.status, `${result.table} direct SQL must be denied`).toBeLessThan(500)
      }

      const privateSubscriptionResults = await privateSubscriptionResultsForPage(alpha.branchPage)
      expect(privateSubscriptionResults).toHaveLength(PRIVATE_CRM_TABLES.length)
      for (const result of privateSubscriptionResults) {
        expect(result.result, `${result.table} direct subscription must be denied`).toBe("denied")
        expect(result.deliveredRows, `${result.table} must deliver zero rows`).toBe(0)
      }

      const ownSubscription = await realtimeSubscribe(alpha.page, {
        resources: CRM_RESOURCES,
        organizationId: alpha.organizationId,
        companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
        activeCompanyId: alpha.mainCompanyId,
      })
      expect(ownSubscription.type, ownSubscription.error).toBe("subscribed")

      const branchOwnSubscription = await realtimeSubscribe(alpha.branchPage, {
        resources: CRM_RESOURCES,
        organizationId: alpha.organizationId,
        companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
        activeCompanyId: alpha.branchCompanyId,
      })
      expect(branchOwnSubscription.type, branchOwnSubscription.error).toBe("subscribed")

      const crossCompanySubscription = await realtimeSubscribe(alpha.page, {
        resources: CRM_RESOURCES,
        organizationId: alpha.organizationId,
        companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
        activeCompanyId: alpha.branchCompanyId,
      })
      expect(crossCompanySubscription.type).toBe("error")
      expect(crossCompanySubscription.error).toMatch(/activeCompanyId is not permitted/i)

      const branchToMainSubscription = await realtimeSubscribe(alpha.branchPage, {
        resources: CRM_RESOURCES,
        organizationId: alpha.organizationId,
        companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
        activeCompanyId: alpha.mainCompanyId,
      })
      expect(branchToMainSubscription.type).toBe("error")
      expect(branchToMainSubscription.error).toMatch(/activeCompanyId is not permitted/i)

      const crossOrganizationSubscription = await realtimeSubscribe(alpha.page, {
        resources: CRM_RESOURCES,
        organizationId: beta.organizationId,
        companyIds: [beta.mainCompanyId],
        activeCompanyId: beta.mainCompanyId,
      })
      expect(crossOrganizationSubscription.type).toBe("error")
      expect(crossOrganizationSubscription.error).toMatch(/organizationId does not match session/i)

      const liveContactName = smokeName("crm-isolation-live-main")
      const change = await waitForRealtimeChange(
        alpha.page,
        {
          resources: CRM_RESOURCES,
          organizationId: alpha.organizationId,
          companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
          activeCompanyId: alpha.mainCompanyId,
        },
        () =>
          callReducerBff(alpha.page, "create_contact", [
            alpha.organizationId,
            contactParams(liveContactName, alpha.mainCompanyId),
          ]),
      )
      expect(change.type).toBe("change")
      expect(change.row).toBeUndefined()
      expect(change.data).toBeUndefined()
      expect(change.payload).toBeUndefined()
      const refreshedMatrix = await queryCrmResourceMatrix(alpha.page, alpha.mainCompanyId)
      const refreshedRows = refreshedMatrix.get("contacts") ?? []
      expect(refreshedRows.some((row) => valueAsString(row, "name") === liveContactName)).toBe(true)

      const mainOnlyContactName = smokeName("crm-isolation-main-only")
      await expectNoRealtimeChange(
        alpha.branchPage,
        {
          // Organization-shared resources (for example activity) may legitimately
          // invalidate both company workspaces. The quiet assertion targets the
          // exact-company resource set whose sibling isolation is guaranteed.
          resources: COMPANY_SCOPED_CRM_RESOURCES,
          organizationId: alpha.organizationId,
          companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
          activeCompanyId: alpha.branchCompanyId,
        },
        () =>
          callReducerBff(alpha.page, "create_contact", [
            alpha.organizationId,
            contactParams(mainOnlyContactName, alpha.mainCompanyId),
          ]),
      )
      const branchAfterMainMutation = await queryRows(
        alpha.branchPage,
        `/api/query/contacts?companyId=${alpha.branchCompanyId}`,
      )
      expect(
        branchAfterMainMutation.some(
          (row) => valueAsString(row, "name") === mainOnlyContactName,
        ),
      ).toBe(false)
      const preReloadMatrix = await queryCrmResourceMatrix(alpha.page, alpha.mainCompanyId)

      await alpha.page.reload()
      const reloadedRows = await queryRows(
        alpha.page,
        `/api/query/contacts?companyId=${alpha.mainCompanyId}`,
      )
      expect(reloadedRows.some((row) => valueAsString(row, "name") === liveContactName)).toBe(true)
      const reloadedMatrix = await queryCrmResourceMatrix(alpha.page, alpha.mainCompanyId)
      for (const resource of CRM_RESOURCES) {
        expect(sortedIds(reloadedMatrix.get(resource))).toEqual(sortedIds(preReloadMatrix.get(resource)))
      }
      expect(
        reloadedRows.some((row) => valueAsString(row, "name") === liveContactName),
      ).toBe(true)
      const reconnected = await realtimeSubscribe(alpha.page, {
        resources: CRM_RESOURCES,
        organizationId: alpha.organizationId,
        companyIds: [alpha.mainCompanyId, alpha.branchCompanyId],
        activeCompanyId: alpha.mainCompanyId,
      })
      expect(reconnected.type).toBe("subscribed")
    } finally {
      await alpha.branchContext.close()
      await alpha.context.close()
      await beta.branchContext.close()
      await beta.context.close()
    }
  })
})
