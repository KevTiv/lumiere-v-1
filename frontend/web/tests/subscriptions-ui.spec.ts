import { test, expect, type Page, type Locator } from '@playwright/test';

async function choose(page: Page, trigger: Locator, label: string) {
  await trigger.click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
async function ready(page: Page, path = '/subscriptions') {
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic subscription save rejected' }) });
    const rows = route.request().url().includes('/api/query/account-moves') ? [{ id: '41', organizationId: '1', companyId: '1', name: 'INV/001', state: { tag: 'Posted' }, moveType: { tag: 'OutInvoice' }, partnerId: '7', currencyId: '8', amountTotal: 120, amountResidual: 75, paymentState: { tag: 'Partial' } }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: rows }) });
  });
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('subscription-fixture-disclosure')).toHaveAttribute('data-hydrated', 'true');
}
async function reachReview(page: Page) {
  await page.getByRole('button', { name: 'New subscription', exact: true }).click();
  const dialog = page.getByTestId('subscription-create-dialog');
  await choose(page, dialog.getByTestId('form-field-saleOrderId'), 'SO-CONFIRMED');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await choose(page, dialog.getByTestId('form-field-planId'), 'Monthly support');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByTestId('form-field-dateStart')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  return dialog;
}
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 600 }]) {
  test.describe(`${viewport.width}px subscription workflow`, () => {
    test.use({ viewport });
    test('overview scopes queues, discloses unavailable sources, and retains advanced destinations', async ({ page }, info) => {
      await ready(page);
      const overview = page.getByTestId('subscription-overview');
      await expect(overview.getByTestId('subscription-queue-drafts').getByText('1', { exact: true })).toBeVisible();
      await expect(overview.getByTestId('subscription-queue-drafts').getByRole('link')).toHaveAttribute('href', '/subscriptions?tab=subscriptions&filter=state:draft');
      const hiddenControls = await page.addStyleTag({ content: 'main > div:first-child { display: none !important; }' });
      await page.locator('main').screenshot({ path: info.outputPath('subscription-overview.png') });
      await info.attach('overview-bounds', { body: JSON.stringify({ main: await page.locator('main').boundingBox(), nav: await page.locator('nav').first().boundingBox(), queues: await overview.boundingBox() }), contentType: 'application/json' });
      await hiddenControls.evaluate((node) => node.parentNode?.removeChild(node));
      await page.getByRole('button', { name: 'Deny synthetic collections' }).click();
      await expect(page.getByTestId('subscription-queue-overdue')).toContainText('You do not have access');
      await expect(page.getByTestId('subscription-queue-overdue').getByText('0', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Switch synthetic company' }).click();
      await expect(overview.getByTestId('subscription-queue-drafts').getByText('1', { exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('SUB-DRAFT');
      await page.getByTestId('module-workspace-subscriptions-overflow').click();
      await expect(page.getByTestId('module-workspace-item-subscriptions-usage-charges')).toHaveAttribute('href', '/subscriptions?tab=usage-charges');
      await expect(page.getByTestId('module-workspace-item-subscriptions-recognition-rules')).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test('creation keeps values through Back and a server rejection, with a reviewed payload', async ({ page }, info) => {
      let posts = 0;
      page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/')) posts++; });
      await ready(page);
      const dialog = await reachReview(page);
      await dialog.getByTestId('form-field-code').fill('ALPHA-REVIEW');
      await dialog.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(dialog.getByTestId('form-field-recurringInterval')).toHaveValue('1');
      await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(dialog.getByTestId('form-field-code')).toHaveValue('ALPHA-REVIEW');
      await expect(dialog.getByRole('region', { name: 'Subscription summary' })).toContainText('SO-CONFIRMED');
      const save = dialog.getByRole('button', { name: 'Create draft subscription', exact: true });
      await save.click();
      await expect(dialog.getByRole('alert')).toContainText('Failed to create subscription from sale order');
      await expect(dialog.getByTestId('form-field-code')).toHaveValue('ALPHA-REVIEW');
      expect(posts).toBe(1);
      await expect(save).toBeInViewport();
      await page.screenshot({ path: info.outputPath('subscription-create-rejected.png') });
    });
    test('missing prerequisites have recovery actions and retain the open creation flow', async ({ page }) => {
      await ready(page);
      await page.getByRole('button', { name: 'Remove synthetic plans' }).click();
      await page.getByRole('button', { name: 'New subscription', exact: true }).click();
      const dialog = page.getByTestId('subscription-create-dialog');
      await expect(dialog).toContainText('An active subscription plan is required');
      await expect(dialog.getByRole('button', { name: 'Create a plan', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
    });
    test('record page recommends one billing action and retains action values after rejection', async ({ page }, info) => {
      await ready(page, '/subscriptions/2');
      const recordPayment = page.getByTestId('subscription-action-pay-invoice');
      await expect(recordPayment).toBeVisible();
      await expect(page.getByTestId('subscription-action-generate-invoice')).toBeHidden();
      await expect(page.getByTestId('subscription-next-step')).toContainText('outstanding balance');
      await recordPayment.click();
      const dialog = page.getByTestId('form-modal-pay-subscription-invoice');
      await expect(dialog.getByTestId('subscription-action-preview')).toContainText('$75.00');
      await choose(page, dialog.getByTestId('form-field-paymentJournalId'), 'BNK — Bank journal');
      for (const field of ['bankAccountId', 'receivableAccountId']) {
        await choose(page, dialog.getByTestId(`form-field-${field}`), field === 'receivableAccountId' ? '120 — Receivable' : '101 — Bank account');
      }
      await expect(dialog.getByTestId('form-field-cogsAccountId')).toHaveCount(0);
      await expect(dialog.getByTestId('form-field-inventoryAccountId')).toHaveCount(0);
      await dialog.getByTestId('form-field-amount').fill('25');
      await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
      await expect(dialog.getByRole('alert')).not.toContainText('not registered');
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByTestId('form-field-amount')).toHaveValue('25.00');
      await page.screenshot({ path: info.outputPath('subscription-payment-rejected.png') });
    });
  });
}
