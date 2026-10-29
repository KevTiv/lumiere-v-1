import { expect, test } from '@playwright/test';
import { chooseSelectOptionByLabel, chooseSelectOptionByValue, fillField, selectModuleTab, submitForm } from './e2e/helpers';

test('Dashboard navigation is explicit when Sales defaults to Orders and preserves company scope', async ({ page }) => {
  await page.goto('/sales?module=sales&defaultTab=orders&company=7&filter=id:12&highlight=12');
  await expect(page.getByTestId('navigation-disclosure')).toHaveAttribute('data-hydrated', 'true');
  await expect(page.getByTestId('module-panel-sales-orders')).toBeVisible();
  await selectModuleTab(page, 'sales', 'dashboard');
  await expect(page).toHaveURL((url) => url.searchParams.get('tab') === 'dashboard' && url.searchParams.get('company') === '7' && !url.searchParams.has('filter') && !url.searchParams.has('highlight'));
  await expect(page.getByTestId('module-panel-sales-dashboard')).toBeVisible();
});

test('quotation customer selection uses the exact ID even with duplicate display names', async ({ page }) => {
  await page.goto('/helper-regressions');
  await expect(page.getByTestId('helper-fixture')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Quotation', exact: true }).click();
  await chooseSelectOptionByValue(page, 'partnerId', '223');
  await chooseSelectOptionByValue(page, 'pricelistId', '1');
  await chooseSelectOptionByValue(page, 'warehouseId', '1');
  await submitForm(page, 'new-sale-order');
  await expect(page.getByTestId('saved-fixture')).toContainText('"partnerId":"223"');
});

for (const height of [600, 900]) test(`posting account selection works through the actual form at ${height}px height`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height });
  await page.goto('/helper-regressions');
  await expect(page.getByTestId('helper-fixture')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Post expense report', exact: true }).click();
  await fillField(page, 'accountingDate', '2026-10-28');
  await chooseSelectOptionByLabel(page, 'journalId', 'Purchase journal');
  await chooseSelectOptionByLabel(page, 'defaultExpenseAccountId', 'Expense account 20');
  await chooseSelectOptionByLabel(page, 'payableAccountId', '2000 — Accounts Payable');
  await submitForm(page, 'post-expense-report');
  await expect(page.getByTestId('saved-fixture')).toContainText('"payableAccountId":"1168"');
});

test('message custom record fields are available after choosing advanced reference', async ({ page }) => {
  await page.goto('/helper-regressions');
  await expect(page.getByTestId('helper-fixture')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page.getByTestId('form-field-model')).toBeHidden();
  await chooseSelectOptionByValue(page, 'recordLinkMode', 'custom');
  await page.getByTestId('form-field-model').fill('cov19_record');
  await page.getByTestId('form-field-resId').fill('190019');
  await fillField(page, 'body', 'Synthetic message');
  await submitForm(page, 'new-mail-message');
  await expect(page.getByTestId('saved-fixture')).toContainText('cov19_record');
});
