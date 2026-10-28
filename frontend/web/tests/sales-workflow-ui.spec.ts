import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/sales-workflow');
  await expect(page.getByTestId('sales-fixture')).toHaveAttribute('data-hydrated', 'true');
});

test('one next action follows send, acceptance and confirmation while context stays visible', async ({ page }) => {
  await expect(page.getByTestId('sale-order-next-action')).toHaveText('Send quotation');
  await expect(page.getByTestId('sale-order-totals')).toContainText('$110.00');
  await expect(page.getByTestId('sale-order-handoff-picking-7')).toHaveAttribute('href', '/inventory?tab=transfers&filter=id%3A7');
  await page.getByTestId('sale-order-next-action').click();
  await expect(page.getByTestId('sale-order-next-action')).toHaveText('Record acceptance');
  await page.getByTestId('sale-order-next-action').click();
  await expect(page.getByTestId('sale-order-next-action')).toHaveText('Confirm order');
  await page.getByTestId('sale-order-next-action').click();
  await expect(page.getByTestId('sale-order-next-action')).toHaveText('Create invoice');
});

test('empty quotation leads to product entry and guidance remains visible on the lines tab', async ({ page }) => {
  await page.getByRole('button', { name: 'Empty quotation' }).click();
  await expect(page.getByTestId('sale-order-next-action')).toHaveText('Add products');
  await page.getByTestId('sale-order-next-action').click();
  await expect(page.getByTestId('sale-order-tab-lines')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sale-order-next-step')).toBeVisible();
});

test('blockers are visible text and prevent the next action', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle blocker' }).click();
  await expect(page.getByTestId('sale-order-next-step')).toContainText('Credit approval is required');
  await expect(page.getByTestId('sale-order-next-action')).toBeDisabled();
});

test('failed line reads do not offer sending or an empty quotation', async ({ page }) => {
  await page.getByRole('button', { name: 'Unreadable lines' }).click();
  await expect(page.getByTestId('sale-order-next-step')).toContainText('Order lines are unavailable');
  await expect(page.getByTestId('sale-order-next-action')).toHaveCount(0);
});

for (const width of [390, 768, 1440]) test(`sales workspace stays within the viewport at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await expect(page.getByTestId('sale-order-next-action')).toBeVisible();
  const box = await page.getByTestId('sale-order-next-action').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  if (width === 1440 && process.env.SALES_WORKFLOW_REVIEW_DIR) {
    const directory = process.env.SALES_WORKFLOW_REVIEW_DIR;
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.getByTestId('sale-order-page').screenshot({ path: `${directory}/after.png` });
    await page.goto('/sales-workflow?baseline=1');
    await expect(page.getByTestId('sales-fixture')).toHaveAttribute('data-hydrated', 'true');
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.getByTestId('sale-order-page').screenshot({ path: `${directory}/before.png` });
  }
});
