import { expect, test } from "@playwright/test"

import { expectNoAppError, gotoModule, signIn } from "./helpers"

/**
 * Phase 0 AI harness policy scenarios.
 *
 * - P3-AI-01: green report skill — scope/masking/resource caps/run audit.
 * - P4-AI-01: red action draft — denied capabilities are audited at the policy
 *   boundary and permitted requests become independently approved drafts.
 */
test.describe("AI harness policy", { tag: "@p0" }, () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("P3-AI-01: green report skill resolves scoped, masked summary with audit", async ({
    page,
  }) => {
    test.setTimeout(120_000)

    await gotoModule(page, "/ai-harness")

    // Open the report composer tab.
    await page.getByRole("tab", { name: /report composer/i }).click()
    await expect(page.getByText("Report Composer").first()).toBeVisible()

    // The panel requires a company and the daily business summary report.
    const companySelect = page.locator("[data-testid='report-composer-company-trigger']")
    if (await companySelect.isVisible().catch(() => false)) {
      await companySelect.click()
      const firstOption = page.locator("[role='option']").first()
      await expect(firstOption).toBeVisible({ timeout: 5_000 })
      await firstOption.click()
    }

    const reportSelect = page.locator("[data-testid='report-composer-report-trigger']")
    if (await reportSelect.isVisible().catch(() => false)) {
      await reportSelect.click()
      const option = page.getByRole("option", { name: /daily business summary/i })
      if (await option.isVisible().catch(() => false)) {
        await option.click()
      } else {
        // Close the select if the expected report is not available.
        await page.keyboard.press("Escape")
      }
    }

    const runButton = page.getByTestId("report-composer-run")
    await expect(runButton).toBeVisible()

    const [composeRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/ai/report/compose") && res.status() < 500,
        { timeout: 30_000 },
      ),
      runButton.click(),
    ])

    expect(composeRes.status()).toBe(200)

    const result = (await composeRes.json()) as {
      decision?: { outcome?: string; privacy?: { rowsProcessed?: number; maskedFields?: string[] } }
      summary?: string
      citations?: unknown[]
      audit?: { correlationId?: string; events?: unknown[] }
    }

    expect(result.decision?.outcome).toBe("allow")
    expect(result.decision?.privacy?.rowsProcessed).toBeGreaterThan(0)
    expect(Array.isArray(result.audit?.events)).toBe(true)
    expect(result.audit?.correlationId).toBeTruthy()

    // UI reflects the result.
    await expect(page.getByTestId("report-composer-result")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Policy decision").first()).toBeVisible()
    await expect(page.getByText("allow").first()).toBeVisible()

    await expectNoAppError(page)
  })

  test("P4-AI-01: red action draft denies network capability before persistence", async ({
    request,
  }) => {
    const response = await request.post("/api/ai/action-draft/bridge", {
      data: {
        execution: {
          skill: { skill_key: "create_sale_order_draft", version: 1 },
          company_id: 1,
          correlation_id: `e2e-red-denied-${Date.now()}`,
          input: { partner_id: 1 },
          plan: {
            named_resources: [],
            tool_calls: [{ tool_name: "network", capability: "network" }],
            steps: 1,
            expected_rows: 0,
            output_type: "action_draft.create_sale_order.v1",
          },
        },
        candidate_output: null,
      },
    })

    expect(response.ok()).toBe(true)
    const body = (await response.json()) as {
      decision?: { outcome?: string; reasons?: Array<{ code?: string }> }
      draft_id?: number
    }
    expect(body.decision?.outcome).toBe("deny")
    expect(body.decision?.reasons?.some((reason) => reason.code === "capability_denied")).toBe(
      true,
    )
    expect(body.draft_id).toBeUndefined()
  })

  test("P4-AI-02: red action draft is bridged to a pending approval draft", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    // Build a minimal policy-controlled red action request.
    const bridgeRes = await request.post("/api/ai/action-draft/bridge", {
      data: {
        execution: {
          skill: { skill_key: "create_sale_order_draft", version: 1 },
          company_id: 1,
          correlation_id: `e2e-red-${Date.now()}`,
          metadata: { actor_id: "e2e-tester" },
          input: { partner_id: 1 },
          plan: {
            named_resources: [],
            tool_calls: [
              {
                tool_name: "create_sale_order",
                capability: "action_draft",
              },
            ],
            steps: 1,
            expected_rows: 0,
            output_type: "action_draft.create_sale_order.v1",
          },
        },
        candidateOutput: null,
      },
    })

    expect(bridgeRes.ok()).toBe(true)
    const bridgeJson = (await bridgeRes.json()) as {
      decision?: { outcome?: string; reasons?: Array<{ code?: string }> }
      draft_id?: number
      error?: string
    }

    expect(bridgeJson.error).toBeUndefined()
    expect(bridgeJson.decision?.outcome).toBe("draft_only")
    expect(
      bridgeJson.decision?.reasons?.some((reason) => reason.code === "red_approval_required"),
    ).toBe(true)
    expect(bridgeJson.draft_id).toBeGreaterThan(0)
  })
})
