import { matchesOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"
import { encodeIdentity } from "@lumiere/stdb/stdb-params-json"

import {
  callReducerBff,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  expectNoAppError,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowByText,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
} from "./helpers"

/**
 * Reads the SpacetimeDB identity hex for the authenticated test session
 * from the `stdb_identity` cookie set by the BFF on sign-in.
 * Returns the raw hex string WITHOUT a leading "0x" prefix, which is what
 * `add_helpdesk_team_member` and `assign_ticket` expect as the `Identity`
 * argument when encoded through the reducer BFF.
 */
async function fetchSessionIdentityHex(page: import("@playwright/test").Page): Promise<string> {
  const cookies = await page.context().cookies()
  const identityCookie = cookies.find((c) => c.name === "stdb_identity")
  const raw = identityCookie?.value
  if (!raw) throw new Error("stdb_identity cookie not found — is the session authenticated?")
  return raw.replace(/^0x/i, "")
}

async function ensureSessionAgentContact(
  page: import("@playwright/test").Page,
  organizationId: number,
  identityHex: string,
): Promise<void> {
  const normalizedIdentity = identityHex.replace(/^0x/i, "").toLowerCase()
  const agentName = `E2E Helpdesk Agent ${normalizedIdentity.slice(0, 8)}`
  const hasContact = async () => {
    const response = await page.request.get("/api/query/contacts")
    if (!response.ok()) return false
    const json = (await response.json()) as {
      data?: Array<{ name?: unknown }>
    }
    return (json.data ?? []).some((contact) => contact.name === agentName)
  }

  if (await hasContact()) return

  await callReducerBff(page, "create_contact", [
    organizationId,
    {
      name: agentName,
      type: "contact",
      isCustomer: false,
      isVendor: false,
      isEmployee: true,
      isProspect: false,
      isPartner: false,
      customerRank: 0,
      supplierRank: 0,
      userId: { some: encodeIdentity(identityHex) },
    },
  ])

  await expect.poll(hasContact, { timeout: 30_000 }).toBe(true)
}

/**
 * Polls /api/query/helpdesk-tickets until the ticket with `ticketId` matches
 * the expected `state` tag (e.g. "Closed", "InProgress").
 */
async function waitForTicketState(
  page: import("@playwright/test").Page,
  ticketId: number,
  expectedStateTag: string,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/query/helpdesk-tickets")
        if (!res.ok()) return null
        const json = (await res.json()) as {
          data?: Array<{ id?: unknown; state?: unknown }>
        }
        const row = (json.data ?? []).find((t) => scalarQueryId(t.id) === ticketId)
        if (!row) return null
        const state = row.state
        if (state && typeof state === "object" && "tag" in state) {
          return (state as { tag: string }).tag
        }
        return String(state ?? "")
      },
      { timeout: timeoutMs },
    )
    .toBe(expectedStateTag)
}

/**
 * Polls /api/query/helpdesk-tickets and returns the numeric id for the
 * first ticket whose `name` matches, or throws if it doesn't appear within
 * the timeout.
 */
async function fetchTicketIdByName(
  page: import("@playwright/test").Page,
  name: string,
  timeoutMs = 30_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/query/helpdesk-tickets")
    if (res.ok()) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown; name?: string }> }
      const row = (json.data ?? []).find((t) => t.name === name)
      const id = scalarQueryId(row?.id)
      if (id != null) return id
    }
    await page.waitForTimeout(250)
  }
  throw new Error(`helpdesk ticket not found after create: ${name}`)
}

/**
 * Returns a helpdesk team (id + name) that has at least one associated
 * stage. This org's `helpdesk_team` table is shared across the whole
 * authenticated e2e project (a single storageState / organization is reused
 * by every spec, run fully parallel — see playwright.config.ts), so by the
 * time this spec runs it may contain team fixtures created by other specs
 * (e.g. module-smoke.spec.ts's "new-helpdesk-team" test) that have zero
 * stages. The new-ticket form's Stage select is NOT filtered by the chosen
 * Team — it always lists every stage in the org — so an empty-stage team
 * doesn't itself break stage selection. It does matter for the caller,
 * which needs the *same* team id the ticket was created under so a
 * subsequent `add_helpdesk_team_member` targets the right team for
 * `assign_ticket`'s HLP-006 guard. Resolving a team with stages up front
 * and driving the UI to pick it by name (rather than blindly taking
 * whichever team option renders first) keeps both in sync.
 */
async function fetchHelpdeskTeamWithStages(
  page: import("@playwright/test").Page,
): Promise<{ id: number; name: string }> {
  const teamsRes = await page.request.get("/api/query/helpdesk-teams")
  if (!teamsRes.ok()) throw new Error(`helpdesk-teams query failed: ${teamsRes.status()}`)
  const teamsJson = (await teamsRes.json()) as {
    data?: Array<{ id?: unknown; name?: unknown }>
  }
  const teams = teamsJson.data ?? []

  const stagesRes = await page.request.get("/api/query/helpdesk-stages")
  if (!stagesRes.ok()) throw new Error(`helpdesk-stages query failed: ${stagesRes.status()}`)
  const stagesJson = (await stagesRes.json()) as {
    data?: Array<{ teamId?: unknown; team_id?: unknown }>
  }
  const stages = stagesJson.data ?? []
  const teamIdsWithStages = new Set(
    stages
      .map((s) => scalarQueryId(s.teamId ?? s.team_id))
      .filter((id): id is number => id != null),
  )

  const match = teams.find((t) => {
    const id = scalarQueryId(t.id)
    return id != null && teamIdsWithStages.has(id)
  })
  if (!match) throw new Error("no helpdesk team with at least one stage found in seed data")
  const id = scalarQueryId(match.id)
  if (id == null) throw new Error("matched helpdesk team is missing an id")
  return { id, name: String(match.name ?? "") }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Helpdesk update mutations", { tag: "@phase-6" }, () => {
  test("updates a ticket via edit-ticket and update_ticket reducer", async ({ page }) => {
    test.setTimeout(120_000)

    const ticketName = smokeName("mut-ticket")
    const updatedName = `${ticketName}-updated`

    await gotoModule(page, "/helpdesk", "helpdesk")
    await page.getByTestId("module-tab-helpdesk-tickets").click()
    await waitForBffQueryMinRows(page, "/api/query/helpdesk-teams")
    await waitForBffQueryMinRows(page, "/api/query/helpdesk-stages")
    await page.getByTestId("module-create-helpdesk-tickets").click()
    await expect(page.getByTestId("form-modal-new-helpdesk-ticket")).toBeVisible()
    await fillField(page, "name", ticketName)
    const team = await fetchHelpdeskTeamWithStages(page)
    await chooseSelectOptionByLabel(page, "teamId", team.name)
    await chooseFirstEnabledOption(page, "stageId")
    const [createTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-helpdesk-ticket"),
    ])
    expect(createTicketRes.ok()).toBe(true)
    await expect(page.getByText(ticketName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, ticketName)
    await waitForEntityActionEnabled(page, "entity-action-edit-ticket")
    await page.getByTestId("entity-action-edit-ticket").click()
    await expect(page.getByTestId("form-field-name")).toBeVisible({ timeout: 15_000 })
    await fillField(page, "name", updatedName)
    await chooseSelectOptionByLabel(page, "priority", /high/i)

    const [updateTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "update_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      page.locator('[data-testid^="form-submit-helpdesk-ticket-detail-"]').click(),
    ])
    expect(updateTicketRes.ok()).toBe(true)
    await expect(page.getByText(updatedName).first()).toBeVisible({ timeout: 30_000 })
    await expectNoAppError(page)
  })
})

/**
 * HLP-009: ticket assign → close full lifecycle.
 *
 * Creates a ticket via the UI, then uses the reducer BFF to:
 *   1. Add the session user as a team member (required by assign_ticket's
 *      HLP-006 guard which rejects agents not on the ticket's team).
 *   2. Assign the ticket to that same agent (transitions state to InProgress).
 *   3. Close the ticket via the entity-action-close-ticket row action.
 *
 * Agent assignment uses the BFF rather than the edit-ticket dialog because
 * the dialog's agent dropdown is populated from `orgUsers` which may not
 * reflect the test-run user until its contact row is present — skipping the
 * UI avoids that polling complexity while keeping the real reducer contract
 * under test.
 */
test.describe("Helpdesk ticket assign and close", { tag: "@p0" }, () => {
  test("assigns ticket to agent via BFF then closes it via row action", async ({ page }) => {
    test.setTimeout(180_000)

    const ticketName = smokeName("hlp009-ticket")

    // ── Step 1: navigate and create the ticket via UI ──────────────────────
    await gotoModule(page, "/helpdesk", "helpdesk")
    await page.getByTestId("module-tab-helpdesk-tickets").click()
    await waitForBffQueryMinRows(page, "/api/query/helpdesk-teams")
    await waitForBffQueryMinRows(page, "/api/query/helpdesk-stages")
    await page.getByTestId("module-create-helpdesk-tickets").click()
    await expect(page.getByTestId("form-modal-new-helpdesk-ticket")).toBeVisible()
    await fillField(page, "name", ticketName)
    const team = await fetchHelpdeskTeamWithStages(page)
    await chooseSelectOptionByLabel(page, "teamId", team.name)
    await chooseFirstEnabledOption(page, "stageId")

    const [createTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "create_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      submitForm(page, "new-helpdesk-ticket"),
    ])
    expect(createTicketRes.ok()).toBe(true)
    await expect(page.getByText(ticketName).first()).toBeVisible({ timeout: 30_000 })

    // ── Step 2: resolve test-run context values via BFF queries ───────────
    const organizationId = await fetchSessionOrganizationId(page)
    const teamId = team.id
    const ticketId = await fetchTicketIdByName(page, ticketName)

    // The session user's SpacetimeDB identity is written to the
    // `stdb_identity` cookie by the BFF sign-in flow.
    const identityHex = await fetchSessionIdentityHex(page)
    const identity = encodeIdentity(identityHex)
    await ensureSessionAgentContact(page, organizationId, identityHex)

    // ── Step 3: add session user as team member (idempotent) ──────────────
    // assign_ticket enforces HLP-006: the agent must appear in
    // helpdesk_team_member for the ticket's own team.
    await callReducerBff(page, "add_helpdesk_team_member", [
      organizationId,
      teamId,
      identity,
    ])

    // ── Step 4: assign ticket to the session user via BFF ─────────────────
    // This transitions state: New → InProgress and sets user_id.
    await callReducerBff(page, "assign_ticket", [
      organizationId,
      ticketId,
      identity,
    ])

    await waitForTicketState(page, ticketId, "InProgress")

    // ── Step 5: close the ticket via the entity row action ────────────────
    // Reload the tickets tab to pick up the updated row, select it,
    // then trigger the close action.
    await gotoModule(page, "/helpdesk", "helpdesk")
    await page.getByTestId("module-tab-helpdesk-tickets").click()
    await expect(page.getByText(ticketName).first()).toBeVisible({ timeout: 30_000 })

    await selectEntityRowByText(page, ticketName)
    await waitForEntityActionEnabled(page, "entity-action-close-ticket")

    const [closeTicketRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesOperationResponse(res, "close_ticket") && res.ok(),
        { timeout: 30_000 },
      ),
      page.getByTestId("entity-action-close-ticket").click(),
    ])
    expect(closeTicketRes.ok()).toBe(true)

    // ── Step 6: assert state is Closed ────────────────────────────────────
    await waitForTicketState(page, ticketId, "Closed")
    await expectNoAppError(page)
  })
})
