import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
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

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
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

async function versionSnapshot(page: Page, documentId: number) {
  const response = await page.request.get("/api/query/document-versions")
  if (!response.ok()) throw new Error(`document-versions query failed: ${response.status()}`)
  const rows = ((await response.json()) as { data?: Row[] }).data ?? []
  return rows
    .filter((row) => scalarQueryId(row.documentId ?? row.document_id) === documentId)
    .map((row) => ({
      versionNumber: Number(row.versionNumber ?? row.version_number),
      checksum: String(row.checksum ?? ""),
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

  test("uploads a new version through the UI and rejects an identical replay", async ({ browser, page }) => {
    test.setTimeout(240_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const companyId = await fetchDefaultCompanyId(page)
    const name = smokeName("cov18-version")
    await createFixtureDocument(page, organizationId, companyId, name)
    const created = (await documentRows(page)).filter((row) => row.name === name)
    expect(created).toHaveLength(1)
    const documentId = scalarQueryId(created[0]?.id)
    if (documentId == null) throw new Error("created document not found")
    const initial = await versionSnapshot(page, documentId)
    expect(initial).toEqual([{ versionNumber: 1, checksum: "b".repeat(64), isCurrent: true }])

    await gotoModule(page, "/documents", "documents")
    await selectEntityRowById(page, documentId)
    await page.getByTestId("entity-action-upload-document-version").click()
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "cov18-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`COV-18 version 2 ${name}`),
    })
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "add_document_version"), {
        timeout: 60_000,
      }),
      page.getByRole("button", { name: /^upload version$/i }).click(),
    ])
    expect(accepted.ok()).toBe(true)

    await expect
      .poll(async () => (await versionSnapshot(page, documentId)).map((v) => [v.versionNumber, v.isCurrent]))
      .toEqual([
        [1, false],
        [2, true],
      ])
    const after = await versionSnapshot(page, documentId)
    expect(after[0]).toEqual({ versionNumber: 1, checksum: "b".repeat(64), isCurrent: false })
    expect(after[1]!.checksum).not.toBe("b".repeat(64))

    // Re-registering the current blob is a stale replay: rejected, no new row.
    const stale = await replay(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await versionSnapshot(page, documentId)).toEqual(after)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await versionSnapshot(page, documentId)).toEqual(after)
    } finally {
      await readerContext.close()
    }
  })
})
