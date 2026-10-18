import { createHash } from "node:crypto"
import { expect, test, type Page, type Request } from "@playwright/test"

import {
  selectModuleTab,
  chooseFirstEnabledOption,
  chooseSelectOptionByLabel,
  fetchAccountIdByCode,
  fetchAccountSelectLabelByInternalType,
  fetchSessionOrganizationId,
  fillField,
  gotoModule,
  isoDate,
  scalarQueryId,
  selectEntityRowById,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

const PERSONA_PASSWORD =
  process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const some = <T>(value: T) => ({ some: value })
const none = { none: [] as [] }
type Row = Record<string, unknown>

/**
 * Trusted fixture call for linking the finance persona to its employee row.
 * The session compatibility route cannot faithfully encode Option<Identity>.
 */
async function callOwnerRaw(reducer: string, args: unknown[]): Promise<void> {
  const host = (
    process.env.E2E_STDB_HOST ??
    process.env.STDB_HOST ??
    "http://127.0.0.1:3000"
  ).replace(/\/$/, "")
  const moduleName = (
    process.env.STDB_MODULE ?? process.env.E2E_STDB_MODULE
  )?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) {
    throw new Error(
      `trusted fixture call ${reducer} requires STDB_MODULE and STDB_SERVER_TOKEN`,
    )
  }
  const response = await fetch(
    `${host}/v1/database/${moduleName}/call/${reducer}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    },
  )
  if (!response.ok) {
    throw new Error(
      `trusted fixture reducer ${reducer} failed (${response.status}): ${await response.text()}`,
    )
  }
}

function identityHex(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return identityHex(
      record.hex ?? record.Hex ?? record.__identity__ ?? "",
    )
  }
  return String(value ?? "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase()
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

async function sheetSnapshot(page: Page, sheetId: number) {
  const row = (await rows(page, "expense-sheets")).find(
    (candidate) => scalarQueryId(candidate.id) === sheetId,
  )
  if (!row) throw new Error(`expense sheet not found: ${sheetId}`)
  return {
    id: sheetId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: stateTag(row.state),
    submittedBy: identityHex(row.submittedBy ?? row.submitted_by),
    approverId: identityHex(row.approverId ?? row.approver_id),
    accountMoveId:
      scalarQueryId(row.accountMoveId ?? row.account_move_id) ?? null,
    reimbursementMoveId:
      scalarQueryId(
        row.reimbursementMoveId ?? row.reimbursement_move_id,
      ) ?? null,
  }
}

async function moveSnapshot(page: Page, moveId: number) {
  const row = (await rows(page, "account-moves")).find(
    (candidate) => scalarQueryId(candidate.id) === moveId,
  )
  if (!row) throw new Error(`account move not found: ${moveId}`)
  return {
    id: moveId,
    organizationId: scalarQueryId(
      row.organizationId ?? row.organization_id,
    ),
    companyId: scalarQueryId(row.companyId ?? row.company_id),
    state: stateTag(row.state),
  }
}

async function openSheetAction(
  page: Page,
  sheetId: number,
  actionId: string,
) {
  await gotoModule(page, "/expenses", "expenses")
  await selectModuleTab(page, "expenses", "expense-sheets")
  await selectEntityRowById(page, sheetId)
  const action = page.getByTestId(`entity-action-${actionId}`)
  await expect(action).toBeVisible()
  return action
}

test.describe(
  "COV-11 Expense sheet submit → approve → post → reimburse",
  { tag: ["@p0", "@cov11"] },
  () => {
    test("preserves exact sheet and accounting-move effects across SoD, retries and denial", async ({
      browser,
      page,
    }) => {
      test.setTimeout(300_000)
      await gotoModule(page, "/expenses", "expenses")
      const organizationId = await fetchSessionOrganizationId(page)

      const sheetName = smokeName("cov11-sheet")
      const expenseName = smokeName("cov11-line")
      const receiptFileName = `${smokeName("cov11-receipt")}.pdf`
      const receiptBytes = Buffer.from(
        `%PDF-1.4\nCOV-11 receipt ${expenseName}\n%%EOF\n`,
        "utf8",
      )
      const receiptHash = createHash("sha256").update(receiptBytes).digest("hex")
      // Repeated runs share a seed employee/date. Keep the positive fixture
      // distinct under the amount/day/merchant duplicate detector too.
      const existingAmounts = (await rows(page, "expenses")).map(
        (row) => Number(row.totalAmount ?? row.total_amount),
      )
      let expenseAmount = 73.17
      while (existingAmounts.some((amount) => Math.abs(amount - expenseAmount) < 0.02)) expenseAmount += 1

      // Create the report through the operator form so lookup and company scope
      // are exercised before the lifecycle actions begin.
      await selectModuleTab(page, "expenses", "expense-sheets")
      await page.getByTestId("module-create-expenses-expense-sheets").click()
      await fillField(page, "name", sheetName)
      await chooseFirstEnabledOption(page, "pricelistId")
      await chooseFirstEnabledOption(page, "employeeId")
      const [sheetCreated] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_expense_sheet"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-expense-sheet"),
      ])
      expect(sheetCreated.ok(), await sheetCreated.text()).toBe(true)
      const sheet = (await rows(page, "expense-sheets")).find(
        (row) => row.name === sheetName,
      )
      const sheetId = scalarQueryId(sheet?.id)
      const companyId = scalarQueryId(sheet?.companyId ?? sheet?.company_id)
      if (sheetId == null) throw new Error("created expense sheet not found")
      if (companyId == null) throw new Error("created expense sheet has no company")

      // Upload real bytes through presign -> object store -> complete, then let
      // the expense form register and attach the resulting receipt row.
      await selectModuleTab(page, "expenses", "expenses")
      await page.getByTestId("module-create-expenses-expenses").click()
      await fillField(page, "name", expenseName)
      await fillField(page, "totalAmount", expenseAmount.toFixed(2))
      await fillField(page, "date", isoDate(0))
      await chooseFirstEnabledOption(page, "pricelistId")
      await chooseFirstEnabledOption(page, "employeeId")
      await page.getByTestId("form-field-receiptFile").setInputFiles({
        name: receiptFileName,
        mimeType: "application/pdf",
        buffer: receiptBytes,
      })
      const [blobCompleted, receiptRegistered, expenseCreated] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/api/documents/blobs/complete") && response.ok(),
          { timeout: 45_000 },
        ),
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_expense_receipt"),
          { timeout: 45_000 },
        ),
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "create_expense"),
          { timeout: 45_000 },
        ),
        submitForm(page, "new-expense"),
      ])
      expect(blobCompleted.ok()).toBe(true)
      expect(receiptRegistered.ok(), await receiptRegistered.text()).toBe(true)
      expect(expenseCreated.ok(), await expenseCreated.text()).toBe(true)
      const expense = (await rows(page, "expenses")).find(
        (row) => row.name === expenseName,
      )
      const expenseId = scalarQueryId(expense?.id)
      if (expenseId == null) throw new Error("created expense line not found")
      expect(Number(expense?.totalAmount ?? expense?.total_amount)).toBe(Number(expenseAmount.toFixed(2)))
      const receipt = (await rows(page, "expense-receipts")).find(
        (row) => String(row.fileName ?? row.file_name ?? "") === receiptFileName,
      )
      const receiptId = scalarQueryId(receipt?.id)
      if (receiptId == null) throw new Error("uploaded expense receipt not found")
      expect(String(receipt?.contentHash ?? receipt?.content_hash ?? "")).toBe(receiptHash)
      expect(String(receipt?.storageKey ?? receipt?.storage_key ?? "")).not.toMatch(/^e2e:/)

      // The create command carries a client_request_id; replaying the exact
      // request must resolve to the same line and receipt, never a duplicate.
      const duplicateReceipt = await replay(page, receiptRegistered.request())
      const duplicateCreate = await replay(page, expenseCreated.request())
      expect(duplicateReceipt.ok(), await duplicateReceipt.text()).toBe(true)
      expect(duplicateCreate.ok(), await duplicateCreate.text()).toBe(true)
      expect(
        (await rows(page, "expenses")).filter((row) => row.name === expenseName),
      ).toHaveLength(1)
      expect(
        (await rows(page, "expense-receipts")).filter(
          (row) => String(row.fileName ?? row.file_name ?? "") === receiptFileName,
        ),
      ).toHaveLength(1)

      // Link the draft line to its report through the row action form.
      await page.getByTestId(`entity-row-${expenseId}`).click()
      const addToReport = page.getByRole("button", { name: /Add to report/i })
      await expect(addToReport).toBeVisible()
      await addToReport.click()
      await chooseSelectOptionByLabel(page, "sheetId", sheetName)
      const [lineSubmitted] = await Promise.all([
        page.waitForResponse(
          (response) => matchesOperationResponse(response, "submit_expense"),
          { timeout: 45_000 },
        ),
        submitForm(page, "add-expense-to-report"),
      ])
      expect(lineSubmitted.ok(), await lineSubmitted.text()).toBe(true)

      const submitAction = await openSheetAction(
        page,
        sheetId,
        "submit-sheets",
      )
      const [submitted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "submit_expense_sheet"),
          { timeout: 45_000 },
        ),
        submitAction.click(),
      ])
      expect(submitted.ok(), await submitted.text()).toBe(true)
      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Submitted" })
      const submittedEffect = await sheetSnapshot(page, sheetId)

      const staleSubmit = await replay(page, submitted.request())
      expect(staleSubmit.status()).toBe(422)
      expect(await sheetSnapshot(page, sheetId)).toEqual(submittedEffect)

      const financeContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      })
      const financePage = await financeContext.newPage()
      let approvedRequest: Request | null = null
      try {
        await signIn(
          financePage,
          "fixture.finance@example.test",
          PERSONA_PASSWORD,
        )
        const financeIdentity = identityHex(
          (await financeContext.cookies()).find(
            (cookie) => cookie.name === "stdb_identity",
          )?.value,
        )
        expect(financeIdentity).toMatch(/^[0-9a-f]{64}$/)

        const existingFinanceEmployee = (await rows(page, "employees")).find(
          (employee) =>
            identityHex(employee.userId ?? employee.user_id) === financeIdentity,
        )
        if (!existingFinanceEmployee) {
          const financeEmployeeName = smokeName("cov11-finance-approver")
          await callOwnerRaw("create_employee", [
            organizationId,
            {
              company_id: some(companyId),
              name: financeEmployeeName,
              job_id: none,
              department_id: none,
              employment_type: { fullTime: [] },
              work_email: some("fixture.finance@example.test"),
              employee_number: none,
              job_title: some("Expense approver"),
              parent_id: none,
              coach_id: none,
              work_phone: none,
              mobile_phone: none,
              work_location: none,
              work_contact_partner_id: none,
              date_hired: none,
              gender: none,
              birthday: none,
              marital: none,
              emergency_contact: none,
              emergency_phone: none,
              barcode: none,
              pin: none,
              image_url: none,
              color: none,
              is_active: true,
              metadata: none,
            },
          ])
          const financeEmployeeId = scalarQueryId(
            (await rows(page, "employees")).find(
              (employee) => employee.name === financeEmployeeName,
            )?.id,
          )
          if (financeEmployeeId == null) {
            throw new Error("created finance employee not found")
          }
          await callOwnerRaw("update_employee", [
            organizationId,
            companyId,
            financeEmployeeId,
            {
              name: none,
              job_title: none,
              job_id: none,
              department_id: none,
              parent_id: none,
              work_email: none,
              work_phone: none,
              mobile_phone: none,
              work_location: none,
              work_contact_partner_id: none,
              employment_type: none,
              user_id: some({ __identity__: `0x${financeIdentity}` }),
            },
          ])
        }
        const approveAction = await openSheetAction(
          financePage,
          sheetId,
          "approve-sheets",
        )
        const [approved] = await Promise.all([
          financePage.waitForResponse(
            (response) =>
              matchesOperationResponse(response, "approve_expense_sheet"),
            { timeout: 45_000 },
          ),
          approveAction.click(),
        ])
        expect(approved.ok(), await approved.text()).toBe(true)
        approvedRequest = approved.request()

        await expect
          .poll(() => sheetSnapshot(page, sheetId))
          .toMatchObject({ state: "Approved" })
        const approvedEffect = await sheetSnapshot(page, sheetId)
        expect(approvedEffect.submittedBy).toMatch(/^[0-9a-f]{64}$/)
        expect(approvedEffect.approverId).toMatch(/^[0-9a-f]{64}$/)
        expect(approvedEffect.approverId).not.toBe(approvedEffect.submittedBy)
        const staleApprove = await replay(financePage, approved.request())
        expect(staleApprove.status()).toBe(422)
        expect(await sheetSnapshot(page, sheetId)).toEqual(approvedEffect)
      } finally {
        await financeContext.close()
      }

      if (approvedRequest == null) throw new Error("approve request was not captured")

      const journals = await rows(page, "account-journals")
      const journalRow =
        journals.find(
          (row) => String(row.code ?? "").toUpperCase() === "MISC",
        ) ?? journals[0]
      if (!journalRow) throw new Error("no accounting journal available")
      const journalLabel =
        journalRow.code && journalRow.name
          ? `${journalRow.code} — ${journalRow.name}`
          : String(journalRow.name ?? journalRow.code)

      const expenseLabel = await fetchAccountSelectLabelByInternalType(
        page,
        "expense",
      )
      const payableLabel = await fetchAccountSelectLabelByInternalType(
        page,
        "payable",
      )

      const postAction = await openSheetAction(page, sheetId, "post-sheets")
      await postAction.click()
      await expect(
        page.getByTestId("form-modal-post-expense-report"),
      ).toBeVisible({ timeout: 15_000 })
      await fillField(page, "accountingDate", isoDate(0))
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(
        page,
        "defaultExpenseAccountId",
        expenseLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "payableAccountId",
        payableLabel,
      )

      const [posted] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(response, "post_expense_sheet"),
          { timeout: 45_000 },
        ),
        submitForm(page, "post-expense-report"),
      ])
      expect(posted.ok()).toBe(true)
      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Posted" })
      const postedEffect = await sheetSnapshot(page, sheetId)
      expect(postedEffect.accountMoveId).not.toBeNull()
      const sourceMove = await moveSnapshot(
        page,
        postedEffect.accountMoveId!,
      )
      expect(sourceMove).toMatchObject({
        organizationId,
        companyId: postedEffect.companyId,
        state: "Posted",
      })

      // post_expense_sheet is deliberately same-key idempotent. The raw retry
      // converges successfully and must not create or relink another move.
      const postRetry = await replay(page, posted.request())
      expect(postRetry.ok()).toBe(true)
      expect(await sheetSnapshot(page, sheetId)).toEqual(postedEffect)
      expect(
        await moveSnapshot(page, postedEffect.accountMoveId!),
      ).toEqual(sourceMove)

      const reimburseAction = await openSheetAction(
        page,
        sheetId,
        "reimburse-sheets",
      )
      await reimburseAction.click()
      await expect(
        page.getByTestId("form-modal-reimburse-expense-report"),
      ).toBeVisible({ timeout: 15_000 })

      const liquidityLabel =
        (await fetchAccountSelectLabelByInternalType(
          page,
          "liquidity",
        ).catch(() => null)) ??
        (await (async () => {
          const bankId = await fetchAccountIdByCode(page, "1200")
          const row = (await rows(page, "account-accounts")).find(
            (account) => scalarQueryId(account.id) === bankId,
          )
          return `${String(row?.code ?? "1200")} — ${String(
            row?.name ?? "Bank",
          )}`
        })())

      await fillField(page, "paymentDate", isoDate(0))
      await chooseSelectOptionByLabel(page, "journalId", journalLabel)
      await chooseSelectOptionByLabel(
        page,
        "payableAccountId",
        payableLabel,
      )
      await chooseSelectOptionByLabel(
        page,
        "liquidityAccountId",
        liquidityLabel,
      )

      const [reimbursed] = await Promise.all([
        page.waitForResponse(
          (response) =>
            matchesOperationResponse(
              response,
              "create_expense_reimbursement_payment",
            ),
          { timeout: 45_000 },
        ),
        submitForm(page, "reimburse-expense-report"),
      ])
      expect(reimbursed.ok()).toBe(true)

      await expect
        .poll(() => sheetSnapshot(page, sheetId))
        .toMatchObject({ state: "Done" })
      const doneEffect = await sheetSnapshot(page, sheetId)
      expect(doneEffect.accountMoveId).toBe(postedEffect.accountMoveId)
      expect(doneEffect.reimbursementMoveId).not.toBeNull()
      const reimbursementMove = await moveSnapshot(
        page,
        doneEffect.reimbursementMoveId!,
      )
      expect(reimbursementMove).toMatchObject({
        organizationId,
        companyId: doneEffect.companyId,
        state: "Posted",
      })

      const staleReimbursement = await replay(
        page,
        reimbursed.request(),
      )
      expect(staleReimbursement.status()).toBe(422)
      expect(await sheetSnapshot(page, sheetId)).toEqual(doneEffect)
      expect(
        await moveSnapshot(page, doneEffect.accountMoveId!),
      ).toEqual(sourceMove)
      expect(
        await moveSnapshot(page, doneEffect.reimbursementMoveId!),
      ).toEqual(reimbursementMove)

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
          submitted.request(),
          approvedRequest,
          posted.request(),
          reimbursed.request(),
        ]) {
          const denied = await replay(readerPage, request)
          expect(denied.status()).toBe(403)
        }
        expect(await sheetSnapshot(page, sheetId)).toEqual(doneEffect)
        expect(
          await moveSnapshot(page, doneEffect.accountMoveId!),
        ).toEqual(sourceMove)
        expect(
          await moveSnapshot(page, doneEffect.reimbursementMoveId!),
        ).toEqual(reimbursementMove)
      } finally {
        await readerContext.close()
      }
    })
  },
)
