import { expect, test, type Page } from "@playwright/test"
import type { ImportProposal } from "../lib/import-workflow"

async function mockWorkflow(page: Page, loseExecutionReply = false) {
  const task = "a".repeat(32)
  const digest = "b".repeat(64)
  let proposal: ImportProposal | null = null
  const actions: string[] = []
  await page.route("**/api/query/**", (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path.endsWith("/account-accounts")
      ? [
          {
            id: "8",
            organizationId: "8001",
            companyId: "9001",
            name: "Electricity expense",
            code: "610",
            deprecated: false,
          },
          {
            id: "9",
            organizationId: "8001",
            companyId: "9001",
            name: "Historical clearing",
            code: "299",
            deprecated: false,
          },
        ]
      : path.endsWith("/account-journals")
        ? [
            {
              id: "7",
              organizationId: "8001",
              companyId: "9001",
              name: "Historical adjustments",
              code: "HIST",
              active: true,
            },
          ]
        : path.endsWith("/companies")
          ? [
              {
                id: "9001",
                organizationId: "8001",
                currencyId: "2",
                name: "Synthetic farm",
              },
            ]
          : []
    return route.fulfill({ json: { data } })
  })
  await page.route("**/api/bootstrap/currencies", (route) =>
    route.fulfill({
      json: { data: [{ id: "2", code: "RWF", decimalPlaces: 0 }] },
    }),
  )
  await page.route("**/api/import-reviews/**", (route) =>
    route.fulfill({
      json: {
        id: "71",
        title: "Historical electricity",
        targetEntity: "source_observation",
        sourceFile: "history.csv",
        history: [],
        items: [1, 2].map((number) => ({
          id: String(number),
          revision: 2,
          state: "needs_review",
          values: {
            amount: "12000",
            date: "2024-03-01",
            observation_kind: "expense",
          },
          confirmedFields:
            number === 1 ? ["amount", "date", "observation_kind"] : [],
          reason: null,
          reviewedBy: null,
          reviewedAt: null,
          source: {
            key: `row-${number + 1}`,
            label: `Electricity ${number}`,
            issue: "Settlement remains unknown",
            source: {
              file: "history.csv",
              row: number + 1,
              sha256: "c".repeat(64),
            },
            fields: [
              {
                key: "amount",
                label: "Amount",
                kind: "decimal",
                sourceValue: "12000",
                required: true,
              },
              {
                key: "date",
                label: "Transaction date",
                kind: "date",
                sourceValue: "2024-03-01",
                required: true,
              },
            ],
            proposed: {},
          },
        })),
      },
    }),
  )
  await page.route("**/api/import-tasks/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get("companyId") === "9002")
      return route.fulfill({
        status: 403,
        json: { error: "This import belongs to another company." },
      })
    if (
      route.request().method() === "GET" &&
      url.pathname.includes("/workflow/requests/")
    )
      return proposal &&
        url.pathname.endsWith(`/requests/${proposal.requestKey}`)
        ? route.fulfill({ json: proposal })
        : route.fulfill({ status: 404, json: { error: "Not found" } })
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          version: 1,
          requestId: task,
          organizationId: "8001",
          companyId: "9001",
          capabilities: [],
          proposals: proposal ? [proposal] : [],
        },
      })
    const body = route.request().postDataJSON()
    expect(body.companyId).toBe(9001)
    if (url.pathname.endsWith("/proposals")) {
      actions.push("prepare")
      expect(body.rows).toEqual([
        { itemId: "1", expectedRevision: 2 },
        { itemId: "2", expectedRevision: 2 },
      ])
      proposal = {
        id: "20",
        requestKey: body.requestKey,
        revision: 1,
        digest,
        kind: "historical_expense_journals",
        status: "prepared",
        createdAt: "2026-11-07T00:00:00Z",
        approvedAt: null,
        summary: {
          recordCount: 1,
          lineCount: 2,
          blockedCount: 1,
          totalDebit: "12000",
          totalCredit: "12000",
          currencyId: "2",
          dateFrom: "2024-03-01",
          dateTo: "2024-03-01",
        },
        sources: [
          { itemId: "1", batchId: "71", revision: 2 },
          { itemId: "2", batchId: "71", revision: 2 },
        ],
        entries: [
          {
            itemId: "1",
            batchId: "71",
            sourceRevision: 2,
            sourceFile: "history.csv",
            sourceRow: 2,
            sourceSha256: "c".repeat(64),
            reference: "SOURCE-electricity",
            date: "2024-03-01",
            description: "Electricity",
            amount: "12000",
          },
        ],
        issues: [
          {
            itemId: "2",
            code: "amount_unconfirmed",
            message: "Confirm the second row's amount.",
          },
        ],
        configuration: {
          journalId: body.journalId,
          debitAccountId: body.debitAccountId,
          creditAccountId: body.creditAccountId,
          currencyId: body.currencyId,
          amountField: body.amountField,
          dateField: body.dateField,
          descriptionField: null,
          postingDate: null,
          reason: body.reason,
        },
        execution: {
          phase: "not_started",
          parentRequestId: null,
          lineRequestId: null,
          parentJobId: null,
          lineJobId: null,
        },
        result: null,
        lastError: null,
      }
    } else {
      expect(proposal).not.toBeNull()
      expect(body).toEqual({
        companyId: 9001,
        expectedRevision: 1,
        expectedDigest: digest,
      })
      if (url.pathname.endsWith("/approve")) {
        actions.push("approve")
        proposal = {
          ...proposal!,
          status: "approved",
          approvedAt: "2026-11-07T00:01:00Z",
        }
      } else if (url.pathname.endsWith("/execute")) {
        actions.push("execute")
        proposal = {
          ...proposal!,
          status: "verified",
          execution: {
            phase: "complete",
            parentRequestId: "d".repeat(32),
            lineRequestId: "e".repeat(32),
            parentJobId: "30",
            lineJobId: "31",
          },
          result: {
            verifiedAt: "2026-11-07T00:02:00Z",
            recordCount: 1,
            lineCount: 2,
            totalDebit: "12000",
            totalCredit: "12000",
            currencyId: "2",
            companyId: "9001",
            recordIds: ["90"],
            lineIds: ["91", "92"],
            postedCount: 0,
          },
        }
        if (loseExecutionReply) return route.abort("failed")
      }
    }
    return route.fulfill({ json: proposal })
  })
  return actions
}

async function prepare(page: Page) {
  await page.goto("/import-task-execution")
  for (const [label, option] of [
    ["Journal", "HIST · Historical adjustments"],
    ["Expense debit account", "610 · Electricity expense"],
    ["Credit account", "299 · Historical clearing"],
  ]) {
    await page.getByRole("combobox", { name: label, exact: true }).click()
    await page.getByRole("option", { name: option, exact: true }).click()
  }
  await page
    .getByRole("textbox", {
      name: "Reason for this accounting treatment",
      exact: true,
    })
    .fill("Historical electricity; retain unpaid settlement question")
  await page
    .getByRole("button", { name: "Prepare exact preview", exact: true })
    .click()
  await expect(
    page.getByText("1 draft entries · 2 lines · 1 held source rows", {
      exact: true,
    }),
  ).toBeVisible()
}

test("source confirmation, approval and verified native completion remain distinct across view changes", async ({
  page,
}) => {
  const actions = await mockWorkflow(page)
  await prepare(page)
  expect(actions).toEqual(["prepare"])
  await expect(
    page.getByText("Confirm the second row's amount.", { exact: true }),
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Switch import view", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Approve this exact preview", exact: true })
    .click()
  expect(actions).toEqual(["prepare", "approve"])
  await page
    .getByRole("button", { name: "Create approved draft entries", exact: true })
    .click()
  await expect(
    page.getByText(
      "Verified 1 draft entries and 2 lines; debit and credit each total 12000 RWF.",
      { exact: true },
    ),
  ).toBeVisible()
  await page.getByText("Open created journal entries", { exact: true }).click()
  await expect(
    page.getByRole("link", { name: "SOURCE-electricity", exact: true }),
  ).toHaveAttribute(
    "href",
    "/accounting?tab=journal-entries&importEntryCompany=9001&importEntryIds=90",
  )
  await page.reload()
  await expect(page.getByText("Verified in ERP", { exact: true })).toBeVisible()
  expect(actions).toEqual(["prepare", "approve", "execute"])
  await page
    .getByRole("button", { name: "Change company", exact: true })
    .click()
  await expect(page.getByText("Verified in ERP", { exact: true })).toHaveCount(
    0,
  )
})

test("a lost execution reply recovers the saved verified result without a second dispatch", async ({
  page,
}) => {
  const actions = await mockWorkflow(page, true)
  await prepare(page)
  await page
    .getByRole("button", { name: "Approve this exact preview", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Create approved draft entries", exact: true })
    .click()
  await expect(page.getByText("Verified in ERP", { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText("Verified in ERP", { exact: true })).toBeVisible()
  expect(actions).toEqual(["prepare", "approve", "execute"])
})
