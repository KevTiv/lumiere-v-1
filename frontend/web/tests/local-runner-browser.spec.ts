import { expect, test } from '@playwright/test'

const gateway = '/api/ai/local-runner'
const runId = '9007199254740993'
const verifiedReply = {
  seq: 4, type: 'verified', answer: 'The warehouse has verified low stock.',
  evidence_id: 'c63c8d76-2bce-41f4-a72c-55015f356b82',
  sources: [{
    kind: 'live', trust: 'authoritative', entity_type: 'product', entity_id: '42',
    label: 'Verified product 42', text_snippet: 'Product #42 has 4 units on hand.',
  }],
}
const activity = [
  { seq: 1, type: 'activity', message: 'Checking stock evidence' },
  { seq: 2, type: 'tool', toolId: 'tool-1', name: 'Inventory evidence', status: 'completed' },
  { seq: 3, type: 'usage', scope: 'turn', metric: 'total_tokens', value: 24 },
]

test('local runner reattaches on refresh and shows usage and the verified reply', async ({ page }) => {
  let starts = 0
  let complete = false
  const cursors: number[] = []
  await page.route(`**${gateway}/devices?*`, route => route.fulfill({
    json: {
      version: 1,
      enabled: true,
      devices: [{
        deviceId: 'fixture-device', label: 'Fixture laptop', state: 'online',
        providers: [{ provider: 'codex', state: 'ready', capabilities: ['mcp', 'usage'], funding: 'unknown' }],
      }],
    },
  }))
  await page.route(`**${gateway}/runs`, async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({
      companyId: 4097, conversationId: 'fixture-thread', requestId: 'fixture-request', deviceId: 'fixture-device',
      provider: 'codex', prompt: 'Why is this item low on stock?',
    })
    starts++
    await route.fulfill({ json: { runId, attemptId: 'fixture-attempt' } })
  })
  await page.route(`**${gateway}/runs/${runId}/events?*`, route => {
    const query = new URL(route.request().url()).searchParams
    expect(query.get('companyId')).toBe('4097')
    const after = Number(query.get('after'))
    cursors.push(after)
    const events = complete
      ? [...activity, verifiedReply]
      : activity
    return route.fulfill({
      contentType: 'text/event-stream',
      body: events.filter(event => event.seq > after).map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
    })
  })

  await page.goto('/local-runner')
  await page.getByText('Local agents', { exact: true }).click()
  await expect(page.getByText('Fixture laptop · Online')).toBeVisible()
  await page.getByRole('button', { name: 'Start fixture run' }).click()
  const timeline = page.getByRole('region', { name: 'Local runner activity' })
  await expect(timeline.getByText('Inventory evidence · completed')).toBeVisible()
  await expect(timeline.getByText('turn 24 tokens')).toBeVisible()
  await expect(timeline.getByText('Codex on Fixture laptop · Billing unavailable')).toBeVisible()
  await expect(timeline.getByText('Reconnecting to runner')).toBeVisible()
  await expect.poll(() => cursors.includes(3)).toBe(true)
  expect(starts).toBe(1)

  const initialRequests = cursors.length
  await page.reload({ waitUntil: 'domcontentloaded' })
  complete = true
  await expect(timeline.getByText('Answer verified')).toBeVisible()
  await expect(page.getByText('The warehouse has verified low stock.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Verified product 42' }))
    .toHaveAttribute('href', '/products?tab=products&filter=id%3A42')
  expect(cursors.slice(initialRequests)).toContain(0)
  expect(starts).toBe(1)
})
