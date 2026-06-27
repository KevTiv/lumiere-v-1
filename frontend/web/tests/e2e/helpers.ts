import { expect, type Page } from "@playwright/test"

export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "test@email.com"
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Password123$"

export function smokeName(prefix: string) {
  return `smoke-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export async function expectNoAppError(page: Page) {
  await expect(page.getByText(/application error|internal server error|unhandled runtime error/i)).toHaveCount(0)
}

export async function signIn(page: Page) {
  await page.goto("/sign-in")

  const email = page.getByLabel(/email/i)
  await expect(email, "Email/password auth must be enabled for smoke tests").toBeVisible()

  await email.fill(TEST_EMAIL)
  await page.getByLabel(/password/i).fill(TEST_PASSWORD)
  await page.getByRole("button", { name: /sign in/i }).click()

  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
  await expectNoAppError(page)
}

export async function expectAuthenticatedShell(page: Page) {
  await expect(page.getByTestId("dashboard-sidebar")).toBeVisible()
  await expect(page.getByTestId("sidebar-user")).toBeVisible()
  await expect(page.getByTestId("sidebar-sign-out")).toBeVisible()
  await expectNoAppError(page)
}

export async function gotoModule(page: Page, route: string, moduleId?: string) {
  await page.goto(route)
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expectAuthenticatedShell(page)
  if (moduleId) {
    await expect(page.getByTestId(`module-view-${moduleId}`)).toBeVisible()
  }
}

/** Open an entity tab’s create modal and wait for the form dialog. */
export async function openEntityCreate(
  page: Page,
  route: string,
  moduleId: string,
  tabId: string,
  formId: string,
) {
  await gotoModule(page, route, moduleId)
  await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
  await page.getByTestId(`module-create-${moduleId}-${tabId}`).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
}

export async function openAccountingTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-accounting-${tabId}`).click()
}

/** Click each module tab in order, assert no app error, optionally run per-tab checks. */
export async function assertModuleTabs(
  page: Page,
  moduleId: string,
  tabIds: readonly string[],
  assertTab?: (page: Page, tabId: string) => Promise<void>,
) {
  for (const tabId of tabIds) {
    await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
    await expectNoAppError(page)
    if (assertTab) {
      await assertTab(page, tabId)
    }
  }
}

export async function openSettingsSection(page: Page, sectionId: string) {
  await page.goto("/settings")
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/)
  await expectAuthenticatedShell(page)
  await page.getByTestId(`settings-section-${sectionId}`).click()
  await expectNoAppError(page)
}

/** Open a tab's create modal, cancel, and expect the form dialog to close. */
export async function openTabAndCancelCreate(
  page: Page,
  moduleId: string,
  tabId: string,
  formId: string,
) {
  await page.getByTestId(`module-tab-${moduleId}-${tabId}`).click()
  await page.getByTestId(`module-create-${moduleId}-${tabId}`).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeVisible()
  await page.getByTestId(`form-modal-${formId}`).getByRole("button", { name: /^cancel$/i }).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeHidden()
  await expectNoAppError(page)
}

export async function fillField(page: Page, name: string, value: string) {
  await page.getByTestId(`form-field-${name}`).fill(value)
}

export async function chooseFirstOption(page: Page, name: string) {
  await page.getByTestId(`form-field-${name}`).click()
  await page.getByRole("option").first().click()
}

export async function submitForm(page: Page, formId: string) {
  await page.getByTestId(`form-submit-${formId}`).click()
  await expect(page.getByTestId(`form-modal-${formId}`)).toBeHidden()
  await expectNoAppError(page)
}

/** `YYYY-MM-DD` for `<input type="date">`. */
export function isoDate(daysFromNow = 0) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** `YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`. */
export function isoDateTimeLocal(y: number, month: number, day: number, hour = 0, minute = 0) {
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  const hh = String(hour).padStart(2, "0")
  const min = String(minute).padStart(2, "0")
  return `${y}-${mm}-${dd}T${hh}:${min}`
}

export async function installPostHogResetProbe(page: Page) {
  let resetSeen = false

  await page.exposeFunction("__lumiereNotifyPostHogReset", () => {
    resetSeen = true
  })
  await page.addInitScript(() => {
    window.addEventListener("lumiere:posthog-reset", () => {
      void (window as unknown as { __lumiereNotifyPostHogReset?: () => void }).__lumiereNotifyPostHogReset?.()
    })
  })

  return {
    wasReset: () => resetSeen,
  }
}
