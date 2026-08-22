/**
 * Gate UI — workflows + approvals product surface.
 *
 * Covers publish/simulate, task inbox, company switcher, migrations/ops tabs,
 * and dead-letter recovery controls.
 */
import { expect, test } from "@playwright/test"

import {
  activeTabEntityTable,
  assertModuleTabs,
  callReducerBff,
  expectNoAppError,
  fillField,
  gotoModule,
  openEntityCreate,
  openWorkflowVersionRow,
  seedPublishableWorkflowDraft,
  smokeName,
  submitForm,
  waitForWorkflowVersionStatus,
} from "./helpers"

const WORKFLOW_TAB_IDS = [
  "dashboard",
  "workflows",
  "versions",
  "instances",
  "operations",
  "deadLetters",
  "migrations",
  "migrationResults",
] as const

test.describe("Gate UI — workflows and approvals", { tag: ["@gate-ui", "@p0"] }, () => {
  test("workflows module tabs render including ops, dead letters, and migrations", async ({
    page,
  }) => {
    await gotoModule(page, "/workflows", "workflows")
    await assertModuleTabs(page, "workflows", WORKFLOW_TAB_IDS, async (p, tabId) => {
      if (tabId === "dashboard") {
        await expect(p.getByTestId("quick-action-new_workflow")).toBeVisible()
        return
      }
      await expect(activeTabEntityTable(p)).toBeVisible()
      if (tabId === "workflows") {
        await expect(p.getByTestId("module-create-workflows-workflows")).toBeVisible()
      }
      if (tabId === "migrations") {
        await expect(p.getByTestId("module-create-workflows-migrations")).toBeVisible()
      }
    })
    await expectNoAppError(page)
  })

  test("creates a workflow, publishes a seeded draft, and simulates from the version dialog", async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const workflowName = smokeName("gate-wf")
    const workflowKey = workflowName.toLowerCase().replace(/-/g, "_")

    await openEntityCreate(page, "/workflows", "workflows", "workflows", "new-workflow")
    await fillField(page, "workflowKey", workflowKey)
    await fillField(page, "name", workflowName)
    await fillField(page, "model", "e2e.subject")
    await fillField(page, "schemaVersion", "1")
    const createWait = page.waitForResponse(
      (res) => res.url().includes("/api/call/create_workflow"),
      { timeout: 30_000 },
    )
    await submitForm(page, "new-workflow")
    const createRes = await createWait
    expect(createRes.ok(), await createRes.text()).toBe(true)
    await expect(page.getByText(workflowKey).first()).toBeVisible({ timeout: 30_000 })

    // Graph upsert via BFF (designer WIP); then publish + simulate through the UI dialog.
    const seeded = await seedPublishableWorkflowDraft(page, {
      workflowKey: `${workflowKey}_graph`,
      name: `${workflowName} graph`,
    })

    await openWorkflowVersionRow(page, seeded.versionId)
    await expect(page.getByTestId("workflow-version-publish")).toBeVisible()

    const publishWait = page.waitForResponse(
      (res) => res.url().includes("/api/call/publish_workflow_version"),
      { timeout: 30_000 },
    )
    await page.getByTestId("workflow-version-publish").click()
    const publishRes = await publishWait
    expect(publishRes.ok(), await publishRes.text()).toBe(true)
    await waitForWorkflowVersionStatus(page, seeded.versionId, "Published")

    await openWorkflowVersionRow(page, seeded.versionId)
    await expect(page.getByTestId("workflow-version-simulate")).toBeVisible()
    const simulateWait = page.waitForResponse(
      (res) => res.url().includes("/api/call/simulate_workflow"),
      { timeout: 30_000 },
    )
    await page.getByTestId("workflow-version-simulate").click()
    const simulateRes = await simulateWait
    expect(simulateRes.ok(), await simulateRes.text()).toBe(true)
    await expectNoAppError(page)
  })

  test("approvals inbox loads with company scope and company switcher", async ({ page }) => {
    await gotoModule(page, "/approvals")
    await expect(page.getByTestId("module-view-approvals")).toBeVisible()
    await expect(page.getByRole("heading", { name: /task inbox/i })).toBeVisible()

    await expect(page.getByTestId("company-switcher-loading")).toHaveCount(0, {
      timeout: 30_000,
    })
    const switcher = page.getByTestId("company-switcher-trigger")
    const staticCompany = page.getByTestId("company-switcher-static")
    await expect(switcher.or(staticCompany)).toBeVisible({ timeout: 30_000 })

    if (await switcher.isVisible()) {
      await switcher.click()
      const option = page.locator("[data-testid^='company-switcher-option-']").first()
      await expect(option).toBeVisible()
      await option.click()
    }

    await expect(page.getByTestId("approvals-inbox-count")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("approvals-inbox-empty")).toBeVisible()
    await expect(page.getByRole("link", { name: /workflow definitions/i })).toBeVisible()
    await expectNoAppError(page)
  })

  test("migration create form and dead-letter recovery surface are reachable", async ({
    page,
  }) => {
    const seeded = await seedPublishableWorkflowDraft(page, {
      workflowKey: smokeName("mig-ui").toLowerCase().replace(/-/g, "_"),
    })

    await gotoModule(page, "/workflows", "workflows")
    await page.getByTestId("module-tab-workflows-migrations").click()
    await page.getByTestId("module-create-workflows-migrations").click()
    await expect(page.getByTestId("form-modal-create-migration-plan")).toBeVisible()
    await fillField(page, "workflowId", String(seeded.workflowId))
    await fillField(page, "sourceWorkflowVersionId", String(seeded.versionId))
    await fillField(page, "targetWorkflowVersionId", String(seeded.versionId))
    await page
      .getByTestId("form-modal-create-migration-plan")
      .getByRole("button", { name: /^cancel$/i })
      .click()

    await page.getByTestId("module-tab-workflows-deadLetters").click()
    await expect(activeTabEntityTable(page)).toBeVisible()
    await expectNoAppError(page)
  })
})

test.describe(
  "WRK-009 workflow definition approve and complete lifecycle",
  { tag: ["@gate-ui", "@p0"] },
  () => {
    test("creates a workflow, publishes the draft, and retires the version via BFF reducers", async ({
      page,
    }) => {
      test.setTimeout(180_000)

      const seeded = await seedPublishableWorkflowDraft(page, {
        workflowKey: smokeName("wrk009").toLowerCase().replace(/-/g, "_"),
        name: `WRK-009 ${smokeName("wf")}`,
      })

      await callReducerBff(page, "publish_workflow_version", [
        seeded.organizationId,
        seeded.versionId,
        seeded.draftRevision,
      ])
      await waitForWorkflowVersionStatus(page, seeded.versionId, "Published")

      await callReducerBff(page, "retire_workflow_version", [
        seeded.organizationId,
        seeded.versionId,
        seeded.draftRevision,
      ])
      await waitForWorkflowVersionStatus(page, seeded.versionId, "Retired")

      await openWorkflowVersionRow(page, seeded.versionId)
      await expectNoAppError(page)
    })
  },
)
