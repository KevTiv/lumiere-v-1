import { expect, test, type Route, type APIResponse } from "@playwright/test"
import { encodeIdentity } from "@lumiere/erp-shared/stdb-params-json"
import { stdbBffCallUrl } from "@lumiere/stdb/commands/stdb-http"
import { approvalTaskStatus } from "@lumiere/query-hooks/hooks/approval-controls"
import { callReducerBff } from "./helpers"
import { none, some, openActorPages, provisionActor } from "./pretenant-support"
import {
  fetchPurchaseOrderReceipts,
  fetchPurchaseOrderState,
} from "./purchasing-order-fixtures"
import {
  WORK_REVIEWER_PERMISSIONS,
  seedWorkReviewWorkflow,
  workScopeFor,
  createPendingWorkReview,
  openWorkReview,
} from "./work-board-acceptance-support"

const decisionPath = stdbBffCallUrl("decide_workflow_human_task")

async function expectAccessDenied(response: APIResponse) {
  const body = await response.text()
  expect([401, 403, 422], body).toContain(response.status())
  if (response.status() === 422) {
    expect(body).toMatch(
      /permission denied|access denied|unauthoriz|forbidden|not an active organization member|no active.*membership|membership.*(?:inactive|removed|required)/i,
    )
  }
}

// Uses the existing authenticated E2E stack. Only the timing of a real request
// is controlled; authorization, command execution and subsequent reads are live.
test.describe(
  "Finance work board live revocation",
  { tag: ["@dev-fixture", "@work-board"] },
  () => {
    test.describe.configure({ mode: "serial" })

    for (const revoke of ["source read", "organization membership"] as const) {
      test(`${revoke} revocation clears an open review and denies its queued command and same-cookie replay`, async ({
        page,
        browser,
      }) => {
        test.setTimeout(300_000)
        const actor = await provisionActor(
          page,
          `work-revoke-${revoke.replace(/ /g, "-")}`,
          WORK_REVIEWER_PERMISSIONS,
        )
        const observer = await provisionActor(page, "work-revocation-observer", WORK_REVIEWER_PERMISSIONS)
        const workflow = await seedWorkReviewWorkflow(page, [actor.roleId, observer.roleId])
        const sessions = await openActorPages(browser, [actor, observer])
        let pendingRoute: Route | undefined
        try {
          const [reviewer, observerPage] = sessions.pages
          if (!reviewer || !observerPage) throw new Error("Missing independent reviewer sessions")
          const scope = workScopeFor(workflow, actor)
          const pending = await createPendingWorkReview(page, reviewer)
          const before = await openWorkReview(reviewer, scope, pending.taskId)
          const title =
            before.workSourceTitle ||
            `${before.subjectModel ?? before.subject_model ?? ""} #${before.subjectId ?? before.subject_id ?? before.id}`
          const review = reviewer.getByRole("dialog")
          await review
            .getByRole("textbox")
            .fill("A comment from the review that will lose access")
          const cookies = (await reviewer.context().cookies())
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; ")
          expect(cookies.length).toBeGreaterThan(0)
          await reviewer.route(
            (url) => url.pathname === decisionPath,
            (route) => {
              if (route.request().method() !== "POST") return route.continue()
              pendingRoute = route
            },
            { times: 1 },
          )
          await review
            .getByRole("button", { name: "Approve", exact: true })
            .click()
          await expect.poll(() => pendingRoute != null).toBe(true)
          const captured = pendingRoute!.request()
          const commandBody = captured.postDataJSON()

          if (revoke === "source read") {
            await callReducerBff(page, "update_role", [
              actor.roleId,
              {
                name: none,
                description: none,
                is_active: none,
                permissions: some([
                  "organization:read",
                  ...WORK_REVIEWER_PERMISSIONS.filter(
                    (permission) => permission !== "purchase_order:read",
                  ),
                ]),
              },
            ])
          } else {
            await callReducerBff(page, "remove_user_from_organization", [
              encodeIdentity(actor.identityHex),
              workflow.organizationId,
            ])
          }

          const exactPath = `/api/query/workflow-human-tasks?companyId=${workflow.companyId}&workScope=purchasing&workView=eligible&taskId=${pending.taskId}`
          const revoked = await reviewer.request.get(exactPath)
          if (revoke === "source read") {
            expect(revoked.status(), await revoked.text()).toBe(200)
            expect((await revoked.json()).data).toEqual([])
          } else {
            expect([401, 403]).toContain(revoked.status())
          }
          // Polling/realtime must clear the captured review without a reload,
          // including while its former action's HTTP request is still pending.
          await expect(review).toHaveCount(0, { timeout: 35_000 })
          await expect(reviewer.getByText(title, { exact: true })).toHaveCount(
            0,
          )

          const response = await pendingRoute!.fetch()
          await expectAccessDenied(response)
          await pendingRoute!.fulfill({ response })
          pendingRoute = undefined
          const replay = await reviewer.request.post(decisionPath, {
            headers: { "Content-Type": "application/json", Cookie: cookies },
            data: commandBody,
          })
          await expectAccessDenied(replay)

          // A separate eligible reviewer observes the unchanged task; the setup
          // owner independently checks the domain effect below. Neither gains
          // candidate visibility by holding an administrative role.
          const observerRead = await observerPage.request.get(exactPath)
          expect(observerRead.ok(), await observerRead.text()).toBe(true)
          const observerRows = (await observerRead.json()).data as Array<{
            id: number | string
            revision: number | string
            status: unknown
          }>
          expect(observerRows).toHaveLength(1)
          expect(String(observerRows[0]!.id)).toBe(String(pending.taskId))
          expect(Number(observerRows[0]!.revision)).toBe(Number(before.revision))
          expect(approvalTaskStatus({ status: observerRows[0]!.status })).toBe(
            approvalTaskStatus(before),
          )
          expect(
            (
              await fetchPurchaseOrderState(page, pending.orderId)
            )?.toLowerCase(),
          ).toBe("draft")
          expect(
            await fetchPurchaseOrderReceipts(page, pending.orderId),
          ).toHaveLength(0)

          if (revoke === "source read") {
            await callReducerBff(page, "update_role", [
              actor.roleId,
              {
                name: none,
                description: none,
                is_active: none,
                permissions: some([
                  "organization:read",
                  ...WORK_REVIEWER_PERMISSIONS,
                ]),
              },
            ])
            const reopenedCard = reviewer.getByRole("button", {
              name: title,
              exact: true,
            })
            await expect(reopenedCard).toBeVisible({ timeout: 35_000 })
            await expect(review).toHaveCount(0)
            await reopenedCard.click()
            await expect(review.getByRole("textbox")).toHaveText("")
            await expect(
              review.getByRole("button", { name: "Approve", exact: true }),
            ).toBeEnabled()
          }
        } finally {
          if (pendingRoute) await pendingRoute.abort().catch(() => {})
          await sessions.close()
          await workflow.retire()
        }
      })
    }
  },
)
