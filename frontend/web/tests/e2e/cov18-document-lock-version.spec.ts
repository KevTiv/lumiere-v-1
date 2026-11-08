import { expect, test, type Page, type Request } from "@playwright/test"
import { createHash } from "node:crypto"

import {
  selectModuleTab,
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  scalarQueryString,
  selectEntityRowById,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-18 — see docs/plan/erp-cov18-document-lock-version-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function replay(page: Page, request: Request, data: string | Row = request.postData() ?? "") {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data,
  })
}

async function documentRows(page: Page): Promise<Row[]> {
  const response = await page.request.get("/api/query/documents")
  if (!response.ok()) throw new Error(`documents query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function documentSnapshot(page: Page, documentId: number) {
  const matches = (await documentRows(page)).filter((row) => scalarQueryId(row.id) === documentId)
  if (matches.length !== 1) throw new Error(`expected one document ${documentId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: documentId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    isLocked: (row.isLocked ?? row.is_locked) === true,
    hasHolder: (row.lockedBy ?? row.locked_by ?? null) != null,
    lockedAt: JSON.stringify(row.lockedAt ?? row.locked_at ?? null),
  }
}

async function createFixtureDocument(page: Page, organizationId: number, companyId: number, name: string) {
  // Setup only: the document is fixture data; the transitions under test are
  // driven through the /documents UI.
  await callReducerBff(page, "create_document", [
    organizationId,
    some(companyId),
    {
      name,
      description: some("COV-18 fixture"),
      file_name: `${name}.txt`,
      file_size: 42,
      mimetype: "text/plain",
      url: "s3://lumiere-docs-test/cov18-fixture.txt",
      checksum: "b".repeat(64),
      folder_id: none,
      res_model: none,
      res_id: none,
      partner_id: none,
      tag_ids: [],
      is_favorite: false,
      classification_id: none,
      retention_days: none,
      fiscal_kind: none,
      residency_region: none,
      metadata: none,
    },
  ])
}

async function versionSnapshot(page: Page, companyId: number, documentId: number) {
  const response = await page.request.get(`/api/query/document-versions?companyId=${companyId}`)
  if (!response.ok()) throw new Error(`document-versions query failed: ${response.status()}`)
  const rows = ((await response.json()) as { data?: Row[] }).data ?? []
  return rows
    .filter((row) => scalarQueryId(row.documentId ?? row.document_id) === documentId)
    .map((row) => ({
      id: scalarQueryString(row.id),
      documentId: scalarQueryId(row.documentId ?? row.document_id),
      organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
      versionNumber: Number(row.versionNumber ?? row.version_number),
      checksum: scalarQueryString(row.checksum),
      url: scalarQueryString(row.url),
      isCurrent: (row.isCurrent ?? row.is_current) === true,
    }))
    .sort((a, b) => a.versionNumber - b.versionNumber)
}

test.describe("COV-18 exact document lock/unlock", { tag: ["@p0", "@cov18"] }, () => {
  test("locks and unlocks the selected document and preserves it on stale and denied replay", async ({
    browser,
    page,
  }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)

    const name = smokeName("cov18-document")
    await createFixtureDocument(page, organizationId, companyId, name)
    const created = (await documentRows(page)).filter((row) => row.name === name)
    expect(created).toHaveLength(1)
    const documentId = scalarQueryId(created[0]?.id)
    if (documentId == null) throw new Error("created document not found")
    const open = { id: documentId, organizationId, isLocked: false, hasHolder: false, lockedAt: "null" }
    expect(await documentSnapshot(page, documentId)).toEqual(open)

    await gotoModule(page, "/documents", "documents")
    await selectModuleTab(page, "documents", "documents")
    await page.getByTestId("module-view-table-documents").click()
    await selectEntityRowById(page, documentId)
    const lock = page.getByTestId("entity-action-lock-document")
    await expect(lock).toBeEnabled()
    const [locked] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "lock_document"), {
        timeout: 30_000,
      }),
      lock.click(),
    ])
    expect(locked.ok()).toBe(true)

    await expect
      .poll(async () => {
        const { lockedAt, ...state } = await documentSnapshot(page, documentId)
        return { ...state, hasLockTime: lockedAt !== "null" }
      })
      .toEqual({ id: documentId, organizationId, isLocked: true, hasHolder: true, hasLockTime: true })
    const lockedSnapshot = await documentSnapshot(page, documentId)

    // A replayed lock is a stale transition: rejected, row unchanged.
    const staleLock = await replay(page, locked.request())
    expect(staleLock.status()).toBe(422)
    expect(await documentSnapshot(page, documentId)).toEqual(lockedSnapshot)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const deniedLock = await replay(readerPage, locked.request())
      expect(deniedLock.status()).toBe(403)
      expect(await documentSnapshot(page, documentId)).toEqual(lockedSnapshot)

      await selectEntityRowById(page, documentId)
      const unlock = page.getByTestId("entity-action-unlock-document")
      await expect(unlock).toBeEnabled()
      const [unlocked] = await Promise.all([
        page.waitForResponse((response) => matchesOperationResponse(response, "unlock_document"), {
          timeout: 30_000,
        }),
        unlock.click(),
      ])
      expect(unlocked.ok()).toBe(true)
      await expect.poll(() => documentSnapshot(page, documentId)).toEqual(open)

      // Before COV-18 a replayed unlock was a silent no-op success.
      const staleUnlock = await replay(page, unlocked.request())
      expect(staleUnlock.status()).toBe(422)
      expect(await documentSnapshot(page, documentId)).toEqual(open)

      const deniedUnlock = await replay(readerPage, unlocked.request())
      expect(deniedUnlock.status()).toBe(403)
      expect(await documentSnapshot(page, documentId)).toEqual(open)
    } finally {
      await readerContext.close()
    }
  })

  test("saves one uploaded version and recovers an identical retry without duplicating it", async ({ browser, page }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const name = smokeName("cov18-version")
    await createFixtureDocument(page, organizationId, companyId, name)
    const created = (await documentRows(page)).filter((row) => row.name === name)
    expect(created).toHaveLength(1)
    const documentId = scalarQueryId(created[0]?.id)
    if (documentId == null) throw new Error("created document not found")
    const readVersions = () => versionSnapshot(page, companyId, documentId)
    const initial = await readVersions()
    expect(initial).toEqual([
      {
        id: expect.stringMatching(/^[1-9]\d*$/),
        documentId,
        organizationId,
        versionNumber: 1,
        checksum: "b".repeat(64),
        url: "s3://lumiere-docs-test/cov18-fixture.txt",
        isCurrent: true,
      },
    ])

    await gotoModule(page, "/documents", "documents")
    await selectModuleTab(page, "documents", "documents")
    await page.getByTestId("module-view-table-documents").click()
    await selectEntityRowById(page, documentId)
    await page.getByTestId("entity-action-upload-document-version").click()
    const bytes = Buffer.from(`COV-18 version 2 ${name}`)
    const checksum = createHash("sha256").update(bytes).digest("hex")
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "cov18-v2.txt",
      mimeType: "text/plain",
      buffer: bytes,
    })
    const [accepted, reservation] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "add_document_version"), {
        timeout: 60_000,
      }),
      page.waitForRequest(
        (request) =>
          request.method() === "POST" && new URL(request.url()).pathname === "/api/documents/blobs/presign",
      ),
      page.getByRole("button", { name: /^upload version$/i }).click(),
    ])
    expect(accepted.ok()).toBe(true)
    const { submissionId, residency } = reservation.postDataJSON() as {
      submissionId: string
      residency?: string
    }
    expect(submissionId).toMatch(/^[0-9a-f]{32}$/)
    const receiptQuery = new URLSearchParams({ companyId: String(companyId), submissionId })
    if (residency) receiptQuery.set("residency", residency)

    const acceptedRequest = accepted.request()
    const command = acceptedRequest.postDataJSON() as { documentId: number; params: Row & { url: string } }
    const { url } = command.params
    expect(command.documentId).toBe(documentId)
    expect(url).toMatch(new RegExp(`^/api/documents/blobs/object/${organizationId}/[^/]+/[0-9a-f]{32}$`))

    await expect
      .poll(readVersions)
      .toEqual([
        { ...initial[0]!, isCurrent: false },
        {
          id: expect.stringMatching(/^[1-9]\d*$/),
          documentId,
          organizationId,
          versionNumber: 2,
          checksum,
          url,
          isCurrent: true,
        },
      ])
    const after = await readVersions()
    expect(after).toHaveLength(2)
    expect(after[1]!.id).not.toBe(initial[0]!.id)

    // The same submission can recover a lost acknowledgement without another write.
    const recovered = await replay(page, acceptedRequest)
    expect(recovered.status()).toBe(200)
    expect(await readVersions()).toEqual(after)

    const receipt = await page.request.get(`/api/documents/blobs/receipt?${receiptQuery}`)
    expect(receipt.ok(), await receipt.text()).toBe(true)
    expect(await receipt.json()).toMatchObject({
      submissionId,
      registration: { versionDocumentId: String(documentId) },
      registrationState: "registered",
      documentId: String(documentId),
      versionId: after[1]!.id,
      fileSaved: true,
      checksum,
      url,
    })
    const downloaded = await page.request.get(`${url}?sha256=${checksum}`)
    expect(downloaded.ok()).toBe(true)
    expect(await downloaded.body()).toEqual(bytes)

    // Reusing the same blob with different version details is still rejected.
    const conflicting = await replay(page, acceptedRequest, {
      ...command,
      params: { ...command.params, changes_description: some("Conflicting revision details") },
    })
    expect(conflicting.status()).toBe(422)
    expect(await conflicting.text()).toContain("already registered with different version details")
    expect(await readVersions()).toEqual(after)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, acceptedRequest)
      expect(denied.status()).toBe(403)
      expect(await readVersions()).toEqual(after)
    } finally {
      await readerContext.close()
    }
  })
})
