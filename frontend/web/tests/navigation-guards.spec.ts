import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();
});

for (const action of ['Push', 'Replace', 'Next Link']) {
  test(`${action} keeps edits on cancel and navigates once on discard`, async ({ page }) => {
    await page.getByRole('textbox', { name: 'Draft' }).fill('Unsaved');
    const trigger = action === 'Next Link' ? page.getByRole('link', { name: action }) : page.getByRole('button', { name: action, exact: true });
    await trigger.click();
    await page.getByTestId('confirm-dialog-cancel').click();
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved');
    await expect(page).toHaveURL(/\/$/);
    await trigger.click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page).toHaveURL(/\/other$/);
    await expect(page.getByRole('heading', { name: 'Other record' })).toBeVisible();
  });
}

test('browser back and forward restore the editor before asking and preserve history', async ({ page }) => {
  await page.getByRole('button', { name: 'Seed history' }).click();
  await expect(page).toHaveURL(/step=2$/);
  await page.getByRole('textbox', { name: 'Draft' }).fill('Unsaved');
  await page.evaluate(() => history.back());
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page).toHaveURL(/step=2$/);
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved');
  await page.evaluate(() => history.back());
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page).toHaveURL(/step=1$/);
  await page.evaluate(() => history.forward());
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await expect(page).toHaveURL(/step=1$/);
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page).toHaveURL(/step=2$/);
});

test('navigation stays blocked during a save', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle save' }).click();
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle save' }).click();
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(page).toHaveURL(/\/other$/);
});

test('inline edits register a reload guard until the save completes', async ({ page }) => {
  const field = page.getByRole('spinbutton', { name: 'Quantity' });
  await field.fill('8');
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await field.press('Enter');
  await expect(field).toBeEnabled();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test('router back across pages keeps the editor when discard is cancelled', async ({ page }) => {
  await page.getByRole('link', { name: 'Next Link' }).click();
  await expect(page.getByRole('heading', { name: 'Other record' })).toBeVisible();
  await page.getByRole('link', { name: 'Editor' }).click();
  await page.getByRole('textbox', { name: 'Draft' }).fill('Unsaved');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved');
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByRole('heading', { name: 'Other record' })).toBeVisible();
});
