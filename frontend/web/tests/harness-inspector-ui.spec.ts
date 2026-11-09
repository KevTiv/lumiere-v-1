import { expect, test, type Page } from "@playwright/test"

const checkpointHash = "a".repeat(64)
const run = { runId: 42, status: "parked", skillId: 3, agentId: 4, stepCount: 2, tokensUsed: 120, startedAt: "2026-11-03T10:00:00Z" }

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

for (const width of [320, 390]) {
  test.describe(`AI inspector at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } })
    test.describe.configure({ timeout: 60_000 })

    test("opens a loaded run and keeps technical lookup drafts through keyboard disclosure", { tag: "@aside-fit" }, async ({ page }, testInfo) => {
      const requests: Array<{ path: string; body: Record<string, unknown> }> = []
      await page.route("**/api/ai/**", async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const body = request.postDataJSON() as Record<string, unknown>
        requests.push({ path, body })
        if (path.endsWith("/history")) return route.fulfill({ json: { runs: [run], nextCursor: null } })
        if (path === "/api/ai/runs/lifecycle" && (body.intent as { kind?: string })?.kind === "inspect") return route.fulfill({ json: { runId: 42, state: "parked", continuation: { runId: 42, checkpointHash, cursor: 3, concurrencyVersion: 2 }, questions: [{ id: 5, key: "site", prompt: "Which site should receive stock?", status: "open", required: true, revision: 1 }], events: [] } })
        if (path.endsWith("/runs/inspect")) return route.fulfill({ status: 404, json: { error: "Synthetic transcript unavailable" } })
        return route.fulfill({ status: 403, json: { error: "No synthetic mutations are allowed" } })
      })
      await page.goto("/harness-inspector", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("harness-inspector-fixture")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
      const manual = page.locator("summary").filter({ hasText: "Advanced: find a run by identifier" })
      await expect(page.locator("#lifecycle-run-id")).toBeHidden()
      await manual.focus()
      await page.keyboard.press("Enter")
      await page.locator("#lifecycle-run-id").fill("57")
      await manual.focus()
      await page.keyboard.press("Space")
      await expect(page.locator("#lifecycle-run-id")).toBeHidden()
      await page.keyboard.press("Enter")
      await expect(page.locator("#lifecycle-run-id")).toHaveValue("57")
      expect(requests).toEqual([])
      await page.getByRole("button", { name: "Load history", exact: true }).click()
      await page.getByRole("button", { name: "Open run", exact: true }).click()
      await expect(page.getByText("Which site should receive stock?", { exact: true })).toBeVisible()
      expect(requests.find((request) => request.path === "/api/ai/runs/lifecycle")?.body).toEqual({ companyId: 7, intent: { kind: "inspect", runId: 42 } })
      const diagnostics = page.locator("summary").filter({ hasText: "Technical inspector: run checkpoint" })
      await expect(page.locator("code").filter({ hasText: checkpointHash })).toBeHidden()
      await diagnostics.focus()
      await page.keyboard.press("Enter")
      await expect(page.locator("code").filter({ hasText: checkpointHash })).toBeVisible()
      const checkpoint = page.getByTestId("harness-inspector").filter({ has: diagnostics })
      expect(await checkpoint.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await noPageOverflow(page)
      expect(requests.every((request) => request.path.endsWith("/history") || request.path.endsWith("/runs/inspect") || (request.body.intent as { kind?: string })?.kind === "inspect")).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`run-inspector-${width}.png`) })
    })

    test("keeps the latest selected evidence when an earlier read completes late", async ({ page }) => {
      let releaseFirst: (() => void) | undefined
      const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
      let firstFinished: (() => void) | undefined
      const firstDone = new Promise<void>((resolve) => { firstFinished = resolve })
      const inspected: number[] = []
      const requests: string[] = []
      await page.route("**/api/ai/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        requests.push(path)
        if (path.endsWith("/review-queue")) return route.fulfill({ json: { claims: [
          { id: 8, statement: "Synthetic claim A", reviewableByViewer: false },
          { id: 9, statement: "Synthetic claim B", reviewableByViewer: false },
        ], decisions: [], components: [] } })
        if (path === "/api/ai/evidence/inspect") {
          const body = route.request().postDataJSON() as { id: number }
          inspected.push(body.id)
          if (body.id === 8) await firstGate
          await route.fulfill({ json: { targetKind: "claim", targetId: body.id, lineagePasses: true, claims: [{ id: body.id, statement: `Selected evidence ${body.id}`, status: "current" }] } }).catch(() => {})
          if (body.id === 8) firstFinished!()
          return
        }
        return route.fulfill({ status: 403, json: { error: "No synthetic mutations are allowed" } })
      })
      await page.goto("/harness-inspector", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("harness-inspector-fixture")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
      await page.getByRole("button", { name: "Review evidence", exact: true }).click()
      await page.getByTestId("queue-claim-8").getByRole("button", { name: "Inspect", exact: true }).click()
      await expect.poll(() => inspected).toContain(8)
      await page.getByTestId("queue-claim-9").getByRole("button", { name: "Inspect", exact: true }).click()
      await expect(page.getByText("Selected evidence 9", { exact: true })).toBeVisible()
      releaseFirst!()
      await firstDone
      await expect(page.getByText("Selected evidence 9", { exact: true })).toBeVisible()
      await expect(page.getByText("Selected evidence 8", { exact: true })).toHaveCount(0)
      await page.getByRole("button", { name: "Use this claim in a proposed decision", exact: true }).click()
      await expect(page.locator("#adopted-claims")).toHaveValue("9")
      await expect(page.locator("#decision-title")).toBeFocused()
      expect(requests.every((path) => path.endsWith("/review-queue") || path.endsWith("/evidence/inspect"))).toBe(true)
      await noPageOverflow(page)
    })

    test("keeps manual evidence lookup advanced and reports access denial without a verdict", async ({ page }, testInfo) => {
      const paths: string[] = []
      await page.route("**/api/ai/**", async (route) => {
        const path = new URL(route.request().url()).pathname
        paths.push(path)
        if (path.endsWith("/review-queue")) return route.fulfill({ json: { claims: [], decisions: [], components: [] } })
        return route.fulfill({ status: 403, json: { error: "Synthetic reviewer access denied" } })
      })
      await page.goto("/harness-inspector", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("harness-inspector-fixture")).toHaveAttribute("data-ready", "true", { timeout: 30_000 })
      await page.getByRole("button", { name: "Review evidence", exact: true }).click()
      const lookup = page.locator("summary").filter({ hasText: "Advanced: find evidence by identifier" })
      await expect(page.locator("#evidence-target-id")).toBeHidden()
      await lookup.focus()
      await page.keyboard.press("Enter")
      await page.locator("#evidence-target-id").fill("91")
      await lookup.focus()
      await page.keyboard.press("Space")
      await expect(page.locator("#evidence-target-id")).toBeHidden()
      await page.keyboard.press("Enter")
      await expect(page.locator("#evidence-target-id")).toHaveValue("91")
      await page.getByRole("button", { name: "Inspect lineage", exact: true }).click()
      await expect(page.getByRole("alert").filter({ hasText: "Synthetic reviewer access denied" })).toBeVisible()
      expect(paths.filter((path) => path !== "/api/ai/evidence/review-queue")).toEqual(["/api/ai/evidence/inspect"])
      await noPageOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`evidence-inspector-${width}.png`) })
    })
  })
}
