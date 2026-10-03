import { expect, test, type Page, type Request } from "@playwright/test"
import { encodeIdentity } from "@lumiere/stdb/stdb-params-json"

import {
  callReducerBff,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  scalarQueryId,
  selectEntityRowByText,
  signIn,
  smokeName,
  submitForm,
  waitForBffQueryMinRows,
  waitForEntityActionEnabled,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

function identityHex(value: unknown): string {
  if (value == null || value === "") return ""
  if (typeof value === "string") {
    return value.trim().replace(/^0x/i, "").toLowerCase()
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "__identity__" in value
  ) {
    return String((value as { __identity__?: unknown }).__identity__ ?? "")
      .trim()
      .replace(/^0x/i, "")
      .toLowerCase()
  }
  return String(value).trim().replace(/^0x/i, "").toLowerCase()
}

function stateTag(value: unknown): string {
  if (typeof value === "string") return value
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) return String((value as { tag?: unknown }).tag ?? "")
    const keys = Object.keys(value)
    if (keys.length === 1) {
      return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
    }
  }
  return ""
}

function closedAtValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("none" in value) return null
    if ("some" in value) return (value as { some?: unknown }).some ?? null
  }
  return value ?? null
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) {
    throw new Error(`${resource} query failed: ${response.status()}`)
  }
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function fetchSessionIdentityHex(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  const raw = cookies.find((cookie) => cookie.name === "stdb_identity")?.value
  if (!raw) throw new Error("stdb_identity cookie not found")
  return raw.replace(/^0x/i, "").toLowerCase()
}

async function ensureSessionAgentContact(
  page: Page,
  organizationId: number,
  sessionIdentityHex: string,
) {
  const agentName = `COV-14 Agent ${sessionIdentityHex.slice(0, 8)}`
  const contacts = await rows(page, "contacts")
  if (!contacts.some((contact) => contact.name === agentName)) {
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
        userId: { some: encodeIdentity(sessionIdentityHex) },
      },
    ])
  }
}

async function fetchTeamWithStage(page: Page) {
  const teams = await rows(page, "helpdesk-teams")
  const stages = await rows(page, "helpdesk-stages")
  for (const team of teams) {
    const teamId = scalarQueryId(team.id)
    if (teamId == null) continue
    const stage = stages.find(
      (candidate) =>
        scalarQueryId(candidate.teamId ?? candidate.team_id) === teamId,
    )
    if (stage) {
      return {
        id: teamId,
        name: String(team.name ?? ""),
      }
    }
  }
  throw new Error("no helpdesk team with stage available")
}

async function ticketSnapshot(page: Page, ticketId: number) {
  const row = (await rows(page, "helpdesk-tickets")).find(
    (candidate) => scalarQueryId(candidate.id) === ticketId,
  )
  if (!row) throw new Error(`helpdesk ticket not found: ${ticketId}`)
  return {
    id: ticketId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    state: stateTag(row.state),
    assigneeIdentityHex: identityHex(row.userId ?? row.user_id),
    closedAt: closedAtValue(row.closedAt ?? row.closed_at),
  }
}

async function fetchTicketId(page: Page, name: string): Promise<number> {
  let ticketId: number | null = null
  await expect
    .poll(async () => {
      const row = (await rows(page, "helpdesk-tickets")).find(
        (candidate) => candidate.name === name,
      )
      ticketId = scalarQueryId(row?.id)
      return ticketId
    })
    .not.toBeNull()
  if (ticketId == null) throw new Error("created helpdesk ticket not found")
  return ticketId
}

async function sessionUserLabel(page: Page, sessionIdentityHex: string) {
  const response = await page.request.get("/api/settings/users?limit=100")
  if (!response.ok()) {
    throw new Error(`settings users failed: ${response.status()}`)
  }
  const users = ((await response.json()) as { data?: Row[] }).data ?? []
  const user = users.find(
    (candidate) =>
      identityHex(
        candidate.identity ??
          candidate.identityHex ??
          candidate.userIdentity,
      ) === sessionIdentityHex,
  )
  if (!user) throw new Error("current session user is absent from org-users")
  return String(
    user.name ??
      user.email ??
      sessionIdentityHex.slice(0, 10),
  )
}

test.describe(
  "COV-14 Helpdesk ticket assign → close → reopen",
  { tag: ["@p0", "@cov14"] },
  () => {
    test("drives exact assignment, close and reopen with stale/reader preservation", async ({
      browser,
      page,
    }) => {
      test.setTimeout(240_000)

      await gotoModule(page, "/helpdesk", "helpdesk")
      await page.getByTestId("module-tab-helpdesk-tickets").click()
      await waitForBffQueryMinRows(page, "/api/query/helpdesk-teams")
      await waitForBffQueryMinRows(page, "/api/query/helpdesk-stages")

      const organizationId = await fetchSessionOrganizationId(page)
      const sessionIdentityHex = await fetchSessionIdentityHex(page)
      const team = await fetchTeamWithStage(page)
      const agentLabel = await sessionUserLabel(page, sessionIdentityHex)

      await ensureSessionAgentContact(
        page,
        organizationId,
        sessionIdentityHex,
      )
      await callReducerBff(page, "add_helpdesk_team_member", [
        organizationId,
        team.id,
        encodeIdentity(sessionIdentityHex),
      ])

      const ticketName = smokeName("cov14-ticket")
      await page.getByTestId("module-create-helpdesk-tickets").click()
      await expect(
        page.getByTestId("form-modal-new-helpdesk-ticket"),
      ).toBeVisible()
      await fillField(page, "name", ticketName)
      await chooseSelectOptionByLabel(page, "teamId", team.name)
      await chooseFirstEnabledOption(page, "stageId")
      await submitForm(page, "new-helpdesk-ticket")

      const ticketId = await fetchTicketId(page, ticketName)
      const initial = await ticketSnapshot(page, ticketId)
      expect(initial).toMatchObject({
        organizationId,
        state: "New",
        assigneeIdentityHex: "",
        closedAt: null,
      })

      await gotoModule(page, "/helpdesk", "helpdesk")
      await page.getByTestId("module-tab-helpdesk-tickets").click()
      await selectEntityRowByText(page, ticketName)
      await waitForEntityActionEnabled(page, "entity-action-edit-ticket")
      await page.getByTestId("entity-action-edit-ticket").click()
      await expect(page.getByTestId("form-field-agentIdentityHex")).toBeVisible()
      await chooseSelectOptionByLabel(
        page,
        "agentIdentityHex",
        agentLabel,
      )

      const [assigned] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "assign_ticket"),
          { timeout: 45_000 },
        ),
        page.locator(
          `[data-testid="form-submit-helpdesk-ticket-detail-${ticketId}"]`,
        ).click(),
      ])
      expect(assigned.ok()).toBe(true)

      await expect
        .poll(() => ticketSnapshot(page, ticketId))
        .toMatchObject({
          state: "InProgress",
          assigneeIdentityHex: sessionIdentityHex,
          closedAt: null,
        })
      const assignedEffect = await ticketSnapshot(page, ticketId)

      const staleAssign = await replay(page, assigned.request())
      expect(staleAssign.status()).toBe(422)
      expect(await ticketSnapshot(page, ticketId)).toEqual(assignedEffect)

      await gotoModule(page, "/helpdesk", "helpdesk")
      await page.getByTestId("module-tab-helpdesk-tickets").click()
      await selectEntityRowByText(page, ticketName)
      await waitForEntityActionEnabled(page, "entity-action-close-ticket")

      const [closed] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "close_ticket"),
          { timeout: 45_000 },
        ),
        page.getByTestId("entity-action-close-ticket").click(),
      ])
      expect(closed.ok()).toBe(true)

      await expect
        .poll(() => ticketSnapshot(page, ticketId))
        .toMatchObject({
          state: "Closed",
          assigneeIdentityHex: sessionIdentityHex,
        })
      const closedEffect = await ticketSnapshot(page, ticketId)
      expect(closedEffect.closedAt).not.toBeNull()

      const staleClose = await replay(page, closed.request())
      expect(staleClose.status()).toBe(422)
      expect(await ticketSnapshot(page, ticketId)).toEqual(closedEffect)

      await gotoModule(page, "/helpdesk", "helpdesk")
      await page.getByTestId("module-tab-helpdesk-tickets").click()
      await selectEntityRowByText(page, ticketName)
      await waitForEntityActionEnabled(page, "entity-action-reopen-ticket")

      const [reopened] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "reopen_ticket"),
          { timeout: 45_000 },
        ),
        page.getByTestId("entity-action-reopen-ticket").click(),
      ])
      expect(reopened.ok()).toBe(true)

      await expect
        .poll(() => ticketSnapshot(page, ticketId))
        .toMatchObject({
          state: "InProgress",
          assigneeIdentityHex: sessionIdentityHex,
          closedAt: null,
        })
      const reopenedEffect = await ticketSnapshot(page, ticketId)

      const staleReopen = await replay(page, reopened.request())
      expect(staleReopen.status()).toBe(422)
      expect(await ticketSnapshot(page, ticketId)).toEqual(reopenedEffect)

      const readerContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const readerPage = await readerContext.newPage()
      try {
        await signIn(
          readerPage,
          "fixture.reader@example.test",
          PERSONA_PASSWORD,
        )
        for (const request of [
          assigned.request(),
          closed.request(),
          reopened.request(),
        ]) {
          const denied = await replay(readerPage, request)
          expect(denied.status()).toBe(403)
        }
        expect(await ticketSnapshot(page, ticketId)).toEqual(reopenedEffect)
      } finally {
        await readerContext.close()
      }
    })
  },
)
