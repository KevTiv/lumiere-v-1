import { matchesTypedOperationResponse } from "./operation-response"
import { expect, test } from "@playwright/test"

import {
  createAiActionDraftTask,
  expectNoAppError,
  gotoModule,
  smokeName,
} from "./helpers"

/**
 * MVP steps 15–16: AI action draft create → approve/reject (see MVP_WORKFLOW_CONTRACT.md).
 */
test.describe("MVP AI action draft workflow", { tag: "@p0" }, () => {
  test("creates pending draft, approves execution, and rejects a second draft", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    const approveTaskName = smokeName("mvp-ai-approve")
    const rejectTaskName = smokeName("mvp-ai-reject")

    const approveDraftId = await createAiActionDraftTask(page, approveTaskName)
    const rejectDraftId = await createAiActionDraftTask(page, rejectTaskName)

    await gotoModule(page, "/ai-action-drafts")
    await expect(page.getByTestId("module-view-ai-action-drafts")).toBeVisible()

    const approveCard = page.getByTestId(`ai-action-draft-card-${approveDraftId}`)
    await expect(approveCard).toBeVisible({ timeout: 30_000 })
    await approveCard.getByTestId("ai-action-draft-reviewed").click()

    const [approveRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "approve_ai_action_draft") && res.ok(),
        { timeout: 30_000 },
      ),
      approveCard.getByTestId("ai-action-draft-approve").click(),
    ])
    expect(approveRes.ok()).toBe(true)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/ai-action-drafts")
        if (!res.ok()) return ""
        const json = (await res.json()) as {
          data?: Array<{ id?: number | string; status?: string }>
        }
        const row = (json.data ?? []).find((draft) => Number(draft.id) === approveDraftId)
        return String(row?.status ?? "")
      })
      .toBe("approved")

    const rejectCard = page.getByTestId(`ai-action-draft-card-${rejectDraftId}`)
    await expect(rejectCard).toBeVisible({ timeout: 30_000 })

    const [rejectRes] = await Promise.all([
      page.waitForResponse(
        (res) => matchesTypedOperationResponse(res, "reject_ai_action_draft") && res.ok(),
        { timeout: 30_000 },
      ),
      rejectCard.getByTestId("ai-action-draft-reject").click(),
    ])
    expect(rejectRes.ok()).toBe(true)

    await expect
      .poll(async () => {
        const res = await page.request.get("/api/query/ai-action-drafts")
        if (!res.ok()) return ""
        const json = (await res.json()) as {
          data?: Array<{ id?: number | string; status?: string }>
        }
        const row = (json.data ?? []).find((draft) => Number(draft.id) === rejectDraftId)
        return String(row?.status ?? "")
      })
      .toBe("rejected")

    await expectNoAppError(page)
  })
})
