import { expect, test } from "@playwright/test"
import { governedPilotAgentId } from "./governed-pilot"
import { mapRunObservation } from "../../app/(modules)/ai-harness/run-observation"

import {
  chooseSelectOptionByTriggerValue,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  scalarQueryId,
} from "./helpers"

/**
 * GOV-00: authenticated browser -> Next.js BFF -> canonical governed executor
 * -> durable run and ordered trace.
 *
 * The dedicated live-AI lane provisions the promoted `report_analysis` skill,
 * its governed runtime configuration and the agent named by
 * `E2E_GOV00_AGENT_ID`. Other lanes record that missing provisioning as an
 * explicit prerequisite rather than claiming browser coverage.
 *
 *   E2E_GOV00_AGENT_ID=2 E2E_REQUIRE_AI=1 \
 *     pnpm exec playwright test gov00-governed-execution.spec.ts \
 *     --project=authenticated --workers=1
 */

type RunBody = {
  error?: string
  decision?: {
    decision?: {
      correlation?: {
        organization_id?: number
        company_id?: number
        actor_id?: string
      }
    }
  }
  run?: {
    run_id?: number
    status?: string
    skill_key?: string
    steps?: Array<{ step_no?: number }>
  }
}

function requireGovernedRuntime(): number {
  const agentId = governedPilotAgentId({
    E2E_GOV00_AGENT_ID: process.env.E2E_GOV00_AGENT_ID,
    E2E_REQUIRE_AI: process.env.E2E_REQUIRE_AI,
  })
  test.skip(agentId === null, "requires a provisioned governed runtime (set E2E_GOV00_AGENT_ID)")
  return agentId ?? 0
}

test.describe("GOV-00 governed execution", { tag: ["@gov00", "@ai-live"] }, () => {
  test.setTimeout(180_000)

  test("authenticated BFF persists the governed report trace", async ({ page }) => {
    const agentId = requireGovernedRuntime()
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    await page.goto("/ai-harness")
    await page.getByRole("tab", { name: "Report analysis", exact: true }).click()
    await chooseSelectOptionByTriggerValue(page, page.getByLabel("Company", { exact: true }), companyId)
    await chooseSelectOptionByTriggerValue(page, page.getByLabel("AI agent", { exact: true }), agentId)
    await page.getByLabel("What do you want to know?", { exact: true }).fill(
      "Summarize the current report and identify any items needing operator attention.",
    )
    const [response] = await Promise.all([
      page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/ai/skills/report-analysis", { timeout: 120_000 }),
      page.getByRole("button", { name: "Analyze report", exact: true }).click(),
    ])
    const body = (await response.json()) as RunBody

    expect(response.ok(), `governed request failed: HTTP ${response.status()}`).toBeTruthy()
    expect(body.decision?.decision?.correlation).toMatchObject({
      organization_id: organizationId,
      company_id: companyId,
    })
    expect(body.decision?.decision?.correlation?.actor_id).toMatch(/^[0-9a-f]{64}$/)
    expect(body.run?.run_id).toBeGreaterThan(0)
    expect(body.run?.status, "pilot must complete; review/clarification is not settlement").toBe("completed")
    expect(body.run?.skill_key).toBe("report_analysis")
    const stepNumbers = body.run?.steps?.map((step) => step.step_no) ?? []
    expect(stepNumbers.length).toBeGreaterThanOrEqual(2)
    expect(stepNumbers).toEqual(stepNumbers.map((_, index) => index + 1))

    const runId = body.run?.run_id ?? 0
    await expect(page.getByRole("link", { name: "Inspect saved run and cost", exact: true })).toHaveAttribute(
      "href", `/ai-harness?tab=evidence-reviewer&companyId=${companyId}&runId=${runId}`,
    )
    await expect
      .poll(
        async () => {
          const readback = await page.request.get(
            `/api/query/ai-agent-runs?organizationId=${organizationId}`,
          )
          if (!readback.ok()) return null
          const payload = (await readback.json()) as { data?: Array<Record<string, unknown>> }
          return (payload.data ?? []).find((row) => scalarQueryId(row.id) === runId) ?? null
        },
        { timeout: 30_000, message: `durable ai_agent_run ${runId} is queryable` },
      )
      .toMatchObject({
        organizationId,
        companyId,
        status: "completed",
        stepCount: stepNumbers.length,
      })

    const inspect = async () => {
      const response = await page.request.post("/api/ai/evidence/runs/inspect", {
        data: { companyId, runId },
      })
      expect(response.ok(), `run inspection failed: HTTP ${response.status()}`).toBeTruthy()
      return mapRunObservation(await response.json())
    }
    const observed = await inspect()
    expect(observed?.runId).toBe(runId)
    expect(observed?.status).toBe("completed")
    expect(observed?.transcript.length).toBe(stepNumbers.length)
    expect(observed?.transcript.every(step => !step.error)).toBe(true)
    const economics = observed?.economics
    expect(economics?.truncated).toBe(false)
    expect(economics?.providerModelsTruncated).toBe(false)
    expect(economics?.attemptCount).toBeGreaterThan(0)
    expect(economics?.attemptStatuses).toEqual(["succeeded"])
    expect(economics?.reservationStatuses).toEqual(["settled"])
    expect(economics?.outcomeUnknown).toBe(false)
    expect(economics?.providerModels.length).toBeGreaterThan(0)
    expect(economics?.providerModels.every(profile => profile.provider === "mistral")).toBe(true)
    expect(economics?.inputTokens).toBeGreaterThan(0)
    expect(economics?.outputTokens).toBeGreaterThan(0)
    expect(economics?.settledUnits).toBeGreaterThan(0)
    // Reconnect only observes the original run; it does not submit another run.
    await page.reload()
    expect(await inspect()).toEqual(observed)
  })
})
