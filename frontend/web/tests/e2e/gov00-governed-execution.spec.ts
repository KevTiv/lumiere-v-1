import { expect, test } from "@playwright/test"

import {
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
  const rawAgentId = process.env.E2E_GOV00_AGENT_ID?.trim()
  const agentId = rawAgentId ? Number(rawAgentId) : 0
  test.skip(
    !Number.isSafeInteger(agentId) || agentId <= 0,
    "requires a provisioned governed report-analysis runtime (set E2E_GOV00_AGENT_ID)",
  )
  return agentId
}

test.describe("GOV-00 governed execution", { tag: "@gov00" }, () => {
  test.setTimeout(180_000)

  test("authenticated BFF persists the governed report trace", async ({ page }) => {
    await page.goto("/overview")
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)

    const agentId = requireGovernedRuntime()
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const response = await page.request.post("/api/ai/skills/report-analysis", {
      data: {
        companyId,
        inputs: {
          query: "Summarize the current report and identify any items needing operator attention.",
        },
        agentId,
        maxSteps: 5,
      },
      timeout: 120_000,
    })
    const body = (await response.json()) as RunBody

    expect(response.ok(), body.error ?? JSON.stringify(body)).toBeTruthy()
    expect(body.decision?.decision?.correlation).toMatchObject({
      organization_id: organizationId,
      company_id: companyId,
    })
    expect(body.decision?.decision?.correlation?.actor_id).toMatch(/^[0-9a-f]{64}$/)
    expect(body.run?.run_id).toBeGreaterThan(0)
    expect(body.run?.status).toBe("agent_settled")
    expect(body.run?.skill_key).toBe("report_analysis")
    expect(body.run?.steps?.map((step) => step.step_no)).toEqual([1, 2, 3])

    const runId = body.run?.run_id ?? 0
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
        status: "agent_settled",
        stepCount: 3,
      })
  })
})
