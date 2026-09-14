import { expect, test } from '@playwright/test'

const authState = process.env.PRESENTATION_AUTH_STATE ?? 'tests/e2e/.auth/user.json'

test.use({ storageState: authState })

function savedDefinition(title: string) {
  return {
    schemaVersion: 1, moduleId: 'collections-preview', title,
    applicationContract: 'test-contract', componentCatalogVersion: 1, baseRevision: '1',
    pages: [{ id: 'entries', title: 'Accounting entries', nodes: [
      { kind: 'collection', id: 'entries', slot: 'primary', component: { id: 'erp.collection', version: 1 }, resource: 'account-moves', fields: ['id', 'name'], pageSize: 25 },
      { kind: 'detail', id: 'entry-detail', slot: 'secondary', component: { id: 'erp.detail', version: 1 }, sourceNodeId: 'entries', fields: ['id', 'name'] },
    ] }],
  }
}

test('preserves an edit made while a draft save is pending', async ({ page }) => {
  let releaseSave: (() => void) | undefined
  let saveBody: { definition: Record<string, unknown>; expectedRevision?: string | null } | undefined

  await page.route('**/api/presentation/preview', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { applicationContract: 'test-contract', fields: ['id', 'name'] } })
      return
    }
    const request = route.request().postDataJSON() as { companyId: string; definition: Record<string, unknown> }
    await route.fulfill({ json: { definition: request.definition, collections: [] } })
  })
  await page.route('**/api/presentation/drafts', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { drafts: [] } })
      return
    }
    saveBody = route.request().postDataJSON() as typeof saveBody
    await new Promise<void>((resolve) => { releaseSave = resolve })
    const definition = saveBody?.definition ?? {}
    await route.fulfill({ json: {
      moduleKey: 'collections-preview', revision: '1', definitionHash: 'a'.repeat(64),
      definition: { ...definition, baseRevision: '1' },
    } })
  })
  await page.route('**/api/presentation/drafts/collections-preview', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'No saved draft' } })
  })

  await page.goto('/presentation-preview')
  await expect(page).not.toHaveURL(/\/sign-in/)
  const title = page.getByLabel('Module title')
  await expect(title).toHaveValue('Collections preview')
  await title.fill('Submitted title')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  await expect.poll(() => Boolean(releaseSave)).toBe(true)
  await title.fill('Typed while saving')
  releaseSave!()
  await expect(title).toHaveValue('Typed while saving')
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeEnabled()
  expect(saveBody?.definition.title).toBe('Submitted title')
})

test('does not overwrite edits made while reopening a saved draft', async ({ page }) => {
  let detailCalls = 0
  let releaseReopen: (() => void) | undefined
  await page.route('**/api/presentation/preview', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { applicationContract: 'test-contract', fields: ['id', 'name'] } })
    const request = route.request().postDataJSON() as { definition: Record<string, unknown> }
    await route.fulfill({ json: { definition: request.definition, collections: [] } })
  })
  await page.route('**/api/presentation/drafts', async (route) => {
    await route.fulfill({ json: { drafts: [{ moduleKey: 'collections-preview', title: 'Saved title', revision: '1' }] } })
  })
  await page.route('**/api/presentation/drafts/collections-preview', async (route) => {
    detailCalls += 1
    if (detailCalls === 2) await new Promise<void>((resolve) => { releaseReopen = resolve })
    await route.fulfill({ json: { moduleKey: 'collections-preview', revision: '1', definitionHash: 'a'.repeat(64), definition: savedDefinition('Saved title') } })
  })
  await page.goto('/presentation-preview')
  await expect(page).not.toHaveURL(/\/sign-in/)
  const title = page.getByLabel('Module title')
  await expect(title).toHaveValue('Saved title')
  await page.getByRole('button', { name: 'Reopen saved draft' }).click()
  await expect.poll(() => Boolean(releaseReopen)).toBe(true)
  await title.fill('Newer local edit')
  releaseReopen!()
  await expect(title).toHaveValue('Newer local edit')
  await expect(page.getByText('A newer saved draft is available.')).toBeVisible()
})

test('keeps local edits and offers reload after a stale save conflict', async ({ page }) => {
  await page.route('**/api/presentation/preview', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { applicationContract: 'test-contract', fields: ['id', 'name'] } })
    const request = route.request().postDataJSON() as { definition: Record<string, unknown> }
    await route.fulfill({ json: { definition: request.definition, collections: [] } })
  })
  await page.route('**/api/presentation/drafts', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { drafts: [] } })
    await route.fulfill({ status: 409, json: { revision: '2' } })
  })
  await page.route('**/api/presentation/drafts/collections-preview', async (route) => {
    await route.fulfill({ status: 404, json: { error: 'No saved draft' } })
  })
  await page.goto('/presentation-preview')
  await expect(page).not.toHaveURL(/\/sign-in/)
  const title = page.getByLabel('Module title')
  await expect(title).toHaveValue('Collections preview')
  await title.fill('Keep this edit')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('This draft changed elsewhere. Your edits are preserved.')).toBeVisible()
  await expect(title).toHaveValue('Keep this edit')
  await expect(page.getByRole('button', { name: 'Reload saved draft' })).toBeVisible()
})

test('live save and reopen round-trip persists title and revision', async ({ page }) => {
  test.skip(process.env.PRESENTATION_LIVE_ROUNDTRIP !== '1', 'opt-in after the source organization freeze')
  await page.goto('/presentation-preview')
  await expect(page).not.toHaveURL(/\/sign-in/)
  const title = page.getByLabel('Module title')
  await expect(title).toBeVisible()
  const originalTitle = await title.inputValue()
  const initialResponse = await page.request.get('/api/presentation/drafts/collections-preview', { failOnStatusCode: true })
  const initialBody = await initialResponse.json() as { revision: string }
  const initialRevision = BigInt(initialBody.revision)
  const roundTripTitle = `${originalTitle} roundtrip`

  try {
    await title.fill(roundTripTitle)
    const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/presentation/drafts') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect((await saveResponse).ok()).toBe(true)
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    const persisted = await page.request.get('/api/presentation/drafts/collections-preview', { failOnStatusCode: true })
    const persistedBody = await persisted.json() as { revision: string; definition: { title: string } }
    expect(persistedBody.definition.title).toBe(roundTripTitle)
    expect(BigInt(persistedBody.revision)).toBe(initialRevision + 1n)

    await page.reload()
    await expect(page.getByLabel('Module title')).toHaveValue(roundTripTitle)
  } finally {
    const currentTitle = await title.inputValue().catch(() => originalTitle)
    if (currentTitle !== originalTitle) {
      await title.fill(originalTitle)
      const restoreResponse = page.waitForResponse((response) => response.url().endsWith('/api/presentation/drafts') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Save draft' }).click()
      await restoreResponse
    }
  }
})
