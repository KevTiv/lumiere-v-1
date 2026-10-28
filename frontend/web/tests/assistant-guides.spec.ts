import { expect, test } from '@playwright/test';

// These tests exercise the production viewer and modal with in-memory callbacks.
// They do not establish persistence, authorization, or retrieval acceptance.
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.goto('/guides');
  await expect(page.getByRole('heading', { name: 'Vendor bill VB-1042', exact: true })).toBeVisible();
  await expect(page.getByTestId('guide-fixture-ready')).toHaveText('Ready');
});

test('closing a guide retains the mounted ERP draft and returns focus', async ({ page }) => {
  await page.getByRole('textbox', { name: 'ERP draft description' }).fill('Supplier reference retained');
  const opener = page.getByTestId('assistant-guide-card');
  await opener.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('assistant-guide-save-state')).toHaveText('Unsaved draft');
  await expect(page.getByRole('link', { name: 'Vendor bill VB-1042' })).toHaveAttribute('href', '/accounting/invoices/1042');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'ERP draft description' })).toHaveValue('Supplier reference retained');
  await expect(opener).toBeFocused();
});

test('modal and full-page questions use the same conversation callback', async ({ page }) => {
  await page.getByTestId('assistant-guide-card').click();
  await page.getByRole('textbox', { name: 'Ask about this document' }).fill('Explain step two');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Same fixture conversation: Explain step two')).toBeVisible();
  await page.getByRole('button', { name: 'Save guide', exact: true }).click();
  await expect(page.getByTestId('assistant-guide-save-state')).toHaveText('Saved · revision 1');
  await page.screenshot({ path: '/tmp/assistant-guides-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /open full page/i }).click();
  await expect(page).toHaveURL(/\/guides\/full$/, { timeout: 20_000 });
  await expect(page.getByTestId('assistant-guide-save-state')).toHaveText('Saved · revision 1');
  await page.getByRole('textbox', { name: 'Ask about this document' }).fill('Explain the next step');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('guide-fixture-session')).toHaveText('Fixture conversation: 2 questions');
  await page.getByRole('button', { name: 'Back to ERP task' }).click();
  await expect(page).toHaveURL(/\/guides$/, { timeout: 20_000 });
  await expect(page.getByTestId('guide-fixture-session')).toHaveText('Fixture conversation: 2 questions');
});

test('full-page navigation respects the ERP unsaved-work guard', async ({ page }) => {
  await page.getByRole('textbox', { name: 'ERP draft description' }).fill('Do not discard');
  await page.getByTestId('assistant-guide-card').click();
  await page.getByRole('button', { name: /open full page/i }).click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(page.getByRole('textbox', { name: 'ERP draft description' })).toHaveValue('Do not discard');
});

test('failed saves retain edited content and never claim saved state', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Simulate guide save failure' }).check();
  await page.getByTestId('assistant-guide-card').click();
  await page.getByRole('button', { name: 'Edit guide' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('My corrected guide title');
  await page.getByRole('textbox', { name: 'Guide content (Markdown)' }).fill('# My retained correction\n\nCheck this before posting.');
  await page.getByRole('button', { name: 'Save guide', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Fixture storage unavailable. Your edits are retained.');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('My corrected guide title');
  await expect(page.getByRole('textbox', { name: 'Guide content (Markdown)' })).toHaveValue('# My retained correction\n\nCheck this before posting.');
  await expect(page.getByTestId('assistant-guide-save-state')).toHaveText('Unsaved draft');
});

test('static HTML cannot run scripts, submit forms, or fetch external resources', async ({ page }) => {
  const probeRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('guide-probe.invalid')) probeRequests.push(request.url()); });
  await page.getByTestId('assistant-guide-card').click();
  await page.getByRole('button', { name: 'HTML preview' }).click();
  const iframe = page.getByTitle('Static HTML document preview');
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Static bill guide' })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('script,form,img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __guideProbe?: boolean }).__guideProbe)).toBeUndefined();
  expect(probeRequests).toEqual([]);
});

test('mobile guide actions and content stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('assistant-guide-card').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save guide', exact: true })).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Ask about this document' })).toBeInViewport();
  const title = await page.getByTestId('assistant-guide-viewer').getByRole('heading', { name: 'Resolve a bill posting error', level: 2, exact: true }).boundingBox();
  expect(title).not.toBeNull();
  // Reading space matters as well as containment: actions must not squeeze the title.
  expect(title!.width).toBeGreaterThanOrEqual(250);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/assistant-guides-mobile.png', fullPage: true });
});
