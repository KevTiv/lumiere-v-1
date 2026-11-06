import { expect, test, type Page } from "@playwright/test"
import { expectAuthenticatedShell } from "./e2e/helpers"

test.setTimeout(90_000)

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto("/")
  await expect(page.getByTestId("fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
}

async function dragEdge(page: Page, delta: number) {
  const edge = page.getByTestId("sidebar-resize-handle")
  const box = (await edge.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + 100
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta, y, { steps: 12 })
  await page.mouse.up()
}

const container = (page: Page) => page.locator('[data-slot="sidebar-container"]')

test("sidebar edge resizes, snaps both ways, and restores saved width", async ({ page }) => {
  await openWorkspace(page)
  await expect(container(page)).toHaveCSS("width", "256px")
  await dragEdge(page, 64)
  await expect(container(page)).toHaveCSS("width", "320px")
  await page.reload()
  await expect(container(page)).toHaveCSS("width", "320px")
  // Crossing the threshold snaps to the icon rail; pointer capture survives it.
  await dragEdge(page, -180)
  await expect(container(page)).toHaveCSS("width", "48px")
  await page.reload()
  await expect(container(page)).toHaveCSS("width", "48px")
  await dragEdge(page, 200)
  await expect(container(page)).toHaveCSS("width", "248px")
  await dragEdge(page, 250)
  await expect(container(page)).toHaveCSS("width", "400px")
  const edge = page.getByTestId("sidebar-resize-handle")
  await edge.focus()
  await page.keyboard.press("Home")
  await expect(container(page)).toHaveCSS("width", "48px")
  await page.keyboard.press("ArrowRight")
  await expect(container(page)).toHaveCSS("width", "208px")
  await expect(page.getByTestId("workspace-header")).toBeVisible()
})

test("sidebar categories persist and every destination remains accessible in icon mode", async ({ page }) => {
  await openWorkspace(page)
  const finance = page.getByRole("button", { name: "Finance", exact: true })
  const accounting = page.getByTestId("sidebar-link-accounting")
  await finance.click()
  await expect(finance).toHaveAttribute("aria-expanded", "false")
  await expect(accounting).toBeHidden()
  await page.reload()
  await expect(finance).toHaveAttribute("aria-expanded", "false")
  const edge = page.getByTestId("sidebar-resize-handle")
  await edge.focus()
  await page.keyboard.press("Home")
  await expect(accounting).toBeVisible()
  await expect(accounting).toHaveAttribute("aria-label", "Accounting")
  await page.keyboard.press("End")
  await expect(accounting).toBeHidden()
  await finance.focus()
  await page.keyboard.press("Enter")
  await expect(accounting).toBeVisible()
})

test("sidebar highlights the active module for a nested record and leaves AI neutral", async ({ page }) => {
  await openWorkspace(page)
  const ai = page.getByTestId("sidebar-open-ai-chat")
  await expect(ai).toBeVisible()
  await expect(ai).not.toHaveClass(/(?:^|\s)bg-sidebar-accent(?:\s|$)/)
  await page.goto("/accounting/invoices/9007199254741000")
  await expect(page.getByTestId("return-record-ready")).toHaveAttribute("data-hydrated", "true")
  await expect(page.getByTestId("sidebar-link-accounting")).toHaveAttribute("aria-current", "page")
  await expect(page.locator('[data-testid="dashboard-sidebar"] [aria-current="page"]')).toHaveCount(1)
})

test("sidebar categories and account sign-out stay usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.getByTestId("fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("workspace-navigation-toggle").click()
  const finance = page.getByRole("button", { name: "Finance", exact: true })
  await finance.click()
  await expect(page.getByTestId("sidebar-link-accounting")).toBeHidden()
  await finance.click()
  await expect(page.getByTestId("sidebar-link-accounting")).toBeVisible()
  await expect(page.getByTestId("sidebar-resize-handle")).toHaveCount(0)
  await page.keyboard.press("Escape")
  await page.getByTestId("workspace-account-menu").click()
  await expect(page.getByTestId("workspace-user")).toContainText("Alpha Accountant")
  await page.getByTestId("workspace-sign-out").click()
  await page.keyboard.press("Escape")
  await expect(page.getByText("Sign out requested", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

for (const width of [390, 1440]) {
  test(`authenticated shell helper checks the account menu and restores navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    await page.goto("/")
    await expect(page.getByTestId("fixture-disclosure")).toHaveAttribute("data-hydrated", "true")
    await expectAuthenticatedShell(page)
    await expect(page.getByTestId("workspace-user")).toBeHidden()
    if (width < 768) {
      const toggle = page.getByTestId("workspace-navigation-toggle")
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      await toggle.click()
      await expectAuthenticatedShell(page)
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
    }
  })
}
