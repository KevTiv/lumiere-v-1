import { expect, test, type Locator, type Page } from "@playwright/test"

/** Assert the actual layout owner; document width misses clipped/nested overflow. */
async function expectContained(owner: Locator, children?: Locator) {
  await expect(owner).toBeVisible()
  await expect
    .poll(() => owner.evaluate((element) => element.scrollWidth - element.clientWidth), {
      message: owner.toString(),
    })
    .toBeLessThanOrEqual(1)
  if (children) {
    const bounds = await owner.boundingBox()
    expect(bounds).not.toBeNull()
    for (const child of await children.all()) {
      if (!(await child.isVisible())) continue
      const childBounds = await child.boundingBox()
      expect(childBounds).not.toBeNull()
      expect(childBounds!.x).toBeGreaterThanOrEqual(bounds!.x - 1)
      expect(childBounds!.x + childBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
    }
  }
}

async function openFixture(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.route("**/api/**", (route) => {
    // Only browser reads are allowed in this fixture; never execute ERP mutations.
    if (route.request().method() !== "GET") return route.abort()
    return route.fulfill({
      json: { data: [{ id: 1, name: "X".repeat(220), state: "open", amount: 10 }] },
    })
  })
  await page.goto("/overflow", { waitUntil: "domcontentloaded" })
  await expect(page.getByTestId("overflow-fixture-ready")).toHaveAttribute("data-hydrated", "true", { timeout: test.info().timeout })
  await expect(page.getByTestId("entity-action-Create")).toBeVisible()
}

for (const width of [320, 390, 768, 1280]) {
  test(`shared layouts contain long content at ${width}px`, async ({ page }) => {
    await openFixture(page, width)
    const toolbar = page.getByTestId("entity-table-toolbar")
    await expectContained(toolbar, toolbar.locator("button, input"))
    await expectContained(page.getByTestId("entity-active-filters"))
    await page.getByTestId("entity-action-Long").focus()
    await page.keyboard.press("Enter")
    await expect(page.getByTestId("last-action")).toHaveText("Long")
    await page.getByTestId("entity-select-row-1").click()
    await expectContained(page.getByTestId("entity-selection-actions"))
    await page.getByTestId("entity-action-selected").click()
    await expect(page.getByTestId("last-action")).toHaveText("selected")

    const detail = page.getByTestId("detail-sample")
    await expectContained(detail, detail.locator("dd"))
    await expectContained(detail.locator('[data-slot="badge"]'))
    await expect(detail.locator("dd").first()).toContainText("unbroken".repeat(32))
    const attachments = page.getByTestId("record-attachments-panel")
    await expectContained(attachments, attachments.locator("li, a, input, button"))
    await expect(attachments.getByRole("link")).toHaveAttribute("href", /unbroken/)

    // A board/table can scroll deliberately; each card and its children must still fit.
    const board = page.getByTestId("entity-board-readonly")
    const card = page.getByTestId("entity-board-card-1")
    await expectContained(card, card.locator("h4, span"))
    await expectContained(card.locator('[data-slot="badge"]'))
    await expect
      .poll(() => board.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true)
    await board.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    await expect.poll(() => board.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    const table = page.getByTestId("toolbar-sample").locator('[data-slot="table-container"]')
    await expect
      .poll(() => table.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true)

    await expectContained(page.getByTestId("entity-pivot-chart"))
    await expectContained(page.locator("main"))
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1)
  })

  test(`record sheet tabs remain reachable at ${width}px`, async ({ page }) => {
    await openFixture(page, width)
    const opener = page.getByRole("button", { name: "Open record sheet", exact: true })
    await opener.click()
    const tabs = page.getByRole("dialog").locator('[data-slot="tabs-scroll-container"]')
    const dialog = page.getByRole("dialog")
    await expectContained(dialog)
    await expect
      .poll(() => tabs.evaluate((element) => element.scrollWidth > element.clientWidth))
      .toBe(true)
    await page.getByRole("tab", { name: "Overview", exact: true }).focus()
    await page.keyboard.press("End")
    const audit = page.getByRole("tab", { name: "Audit", exact: true })
    await expect(audit).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(audit).toHaveAttribute("aria-selected", "true")
    const tabBounds = await tabs.boundingBox()
    const auditBounds = await audit.boundingBox()
    expect(auditBounds!.x + auditBounds!.width).toBeLessThanOrEqual(
      tabBounds!.x + tabBounds!.width + 1
    )
    const panel = await dialog.getByRole("tabpanel").boundingBox()
    expect(panel!.y).toBeGreaterThanOrEqual(tabBounds!.y + tabBounds!.height - 1)
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
}

test("narrow nested panels stay contained on a wide screen and under text enlargement", async ({
  page,
}) => {
  await openFixture(page, 1280)
  await page.getByLabel("Panel width").selectOption("240")
  await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%"
  })
  await expect(page.getByLabel("Panel width")).toHaveValue("240")
  await expectContained(page.getByTestId("entity-table-toolbar"))
  await expectContained(page.getByTestId("detail-sample"))
  await expectContained(page.getByTestId("record-attachments-panel"))
  await expectContained(page.getByTestId("entity-pivot-chart"))
})

test("query builder added filters fit the panel and remain removable", async ({ page }) => {
  await openFixture(page, 1280)
  await page.getByTestId("qb-model").click()
  await page.getByRole("option", { name: "Sale Order", exact: true }).click()
  await expect(page.getByTestId("qb-source-row-count")).toContainText("1")
  await page.getByRole("button", { name: "Add filter", exact: true }).click()
  const filter = page.getByTestId("qb-filter-row")
  await filter.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "Name", exact: true }).click()
  await filter.getByRole("combobox").nth(1).click()
  await page.getByRole("option", { name: "in (comma-separated)", exact: true }).click()
  await filter.getByRole("textbox").fill("value".repeat(50))
  for (const width of ["240", "560", "1200"]) {
    await page.getByLabel("Panel width").selectOption(width)
    await expectContained(filter, filter.locator("button, input"))
    await expectContained(page.getByTestId("query-builder"))
  }
  await filter.getByRole("button", { name: "Remove filter", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(filter).toHaveCount(0)
})

test("read-only action/tab changes preserve access to the remaining content", async ({ page }) => {
  await openFixture(page, 390)
  await page.getByRole("button", { name: "Toggle read-only", exact: true }).click()
  await expect(page.getByTestId("entity-action-Create")).toHaveCount(0)
  await expectContained(page.getByTestId("entity-table-toolbar"))
  await page.getByRole("button", { name: "Open record sheet", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Privileged", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "Offboarding", exact: true }).click()
  await expect(page.getByRole("tabpanel")).toHaveText("Offboarding content")
})

for (const mode of ["floating", "docked"] as const) {
  test(`${mode} chat contains long messages and preserves newlines`, async ({ page }) => {
    await openFixture(page, 1280)
    await page.getByRole("button", { name: `Open ${mode} chat`, exact: true }).click()
    const message = page.getByTestId("erp-ai-chat-message-assistant")
    await expectContained(message, message.locator("p"))
    await expect(message.locator("p")).toHaveText(/unbroken.*\nPreserved newline/)
    expect(
      await message.locator("p").evaluate((element) => getComputedStyle(element).whiteSpace)
    ).toBe("pre-wrap")
  })
}

async function expectInViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const viewport = page.viewportSize()!
  await expect.poll(async () => {
    const box = await locator.boundingBox()
    return !!box && box.x >= -1 && box.y >= -1
      && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1
  }, { message: `${locator.toString()} must fit in the viewport` }).toBe(true)
}

for (const viewport of [
  { width: 390, height: 600 },
  { width: 390, height: 844 },
  { width: 1440, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`plain dialog stress keeps content and confirmation reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await openFixture(page, viewport.width)
    await page.setViewportSize(viewport)
    const opener = page.getByRole("button", { name: "Open stressed plain dialog", exact: true })
    await opener.click()
    const dialog = page.getByTestId("plain-stress-dialog")
    await page.screenshot({ path: test.info().outputPath("plain-dialog-initial.png") })
    await expectInViewport(page, dialog)
    await expectContained(dialog)
    await expectInViewport(page, dialog.getByRole("button", { name: "Close", exact: true }))
    const lastRow = dialog.getByTestId("plain-stress-row-19")
    await lastRow.scrollIntoViewIfNeeded()
    await expectInViewport(page, lastRow)
    const confirm = dialog.getByTestId("plain-stress-confirm")
    await confirm.scrollIntoViewIfNeeded()
    await expectInViewport(page, confirm)
    await confirm.focus()
    await page.keyboard.press("Enter")
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test(`form dialog stress retains edits and reachable actions after failed save at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await openFixture(page, viewport.width)
    await page.setViewportSize(viewport)
    const opener = page.getByRole("button", { name: "Open stressed form dialog", exact: true })
    await opener.click()
    const dialog = page.getByTestId("form-modal-overflow-stress")
    const save = dialog.getByTestId("form-submit-overflow-stress")
    const close = dialog.getByRole("button", { name: "Close", exact: true })
    const body = dialog.locator("[data-form-body]")
    await page.screenshot({ path: test.info().outputPath("form-dialog-initial.png") })
    await expectInViewport(page, dialog)
    await expectContained(dialog)
    await expectInViewport(page, save)
    await expectInViewport(page, close)

    const first = dialog.getByTestId("form-field-reference-0")
    await first.fill("Unsaved commercial reference")
    const last = dialog.getByTestId("form-field-reference-19")
    await last.scrollIntoViewIfNeeded()
    await last.fill("Last field remains reachable")
    await expectInViewport(page, last)
    expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expectInViewport(page, save)
    await save.click()
    await expect(dialog.getByRole("alert")).toContainText("The example save was rejected")
    await page.screenshot({ path: test.info().outputPath("form-dialog-rejected-save.png") })
    await expectInViewport(page, dialog)
    await expectContained(dialog)
    await expectInViewport(page, save)
    await expectInViewport(page, close)
    await expect(save).toBeEnabled()
    await expect(first).toHaveValue("Unsaved commercial reference")
    await expect(last).toHaveValue("Last field remains reachable")
    await expect.poll(() => body.evaluate((element) => element.clientHeight)).toBeGreaterThan(40)
    await last.scrollIntoViewIfNeeded()
    await expectInViewport(page, last)
    await close.click()
    const discard = page.getByTestId("discard-changes-dialog")
    await expectInViewport(page, discard)
    await discard.getByTestId("discard-changes-keep").click()
    await expect(discard).toBeHidden()
    await expect(last).toHaveValue("Last field remains reachable")
    await close.click()
    await page.getByTestId("discard-changes-confirm").click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
}

test("form picker stays in its own Escape layer and keeps the edited draft", async ({ page }) => {
  await openFixture(page, 390)
  await page.setViewportSize({ width: 390, height: 600 })
  await page.getByRole("button", { name: "Open stressed form dialog", exact: true }).click()
  const dialog = page.getByTestId("form-modal-overflow-stress")
  const customer = dialog.getByTestId("form-field-customer")
  await customer.scrollIntoViewIfNeeded()
  await customer.click()
  const search = page.getByPlaceholder("Search...", { exact: true })
  await search.fill("International")
  const option = page.getByRole("option", { name: /International customer/ })
  await expectInViewport(page, option)
  await expectContained(page.getByRole("listbox"))
  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(customer).toBeFocused()
  await customer.click()
  await page.getByPlaceholder("Search...", { exact: true }).fill("International")
  await page.getByRole("option", { name: /International customer/ }).click()
  await expect(customer).toContainText("International customer")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("discard-changes-dialog")).toBeVisible()
  await page.getByTestId("discard-changes-keep").click()
  await expect(customer).toContainText("International customer")
})
