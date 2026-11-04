import { expect, test } from "@playwright/test"

for (const width of [320, 390, 768, 1440]) {
  test(`shared list controls preserve work at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 })
    const apiRequests: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url())
    })
    await page.goto("/list-toolbar", { waitUntil: "domcontentloaded" })
    // SSR is visible before cold client chunks finish loading. Give hydration its
    // own bounded budget while keeping the interaction assertions at 5 seconds.
    await expect(page.getByTestId("toolbar-disclosure")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 })
    const generic = page.getByRole("region", { name: "Generic records", exact: true })
    const search = generic.getByRole("textbox", { name: "Search records", exact: true })
    const settings = generic.getByRole("button", { name: "View settings", exact: true })
    for (const control of [search, generic.getByRole("combobox", { name: "Status", exact: true }), settings,
      ...["List", "Board", "Summary"].map((name) => generic.getByRole("button", { name, exact: true }))]) {
      await expect(control).toBeVisible()
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await expect(generic.getByTestId("entity-row-40")).toBeVisible()
    await expect(generic.getByTestId("entity-row-1")).toHaveCount(0)
    await expect(generic.getByTestId("table-density")).toBeHidden()
    await search.fill("Synthetic order 1")
    await expect(generic.locator('[data-testid^="entity-row-"]')).toHaveCount(11)
    await generic.getByTestId("entity-select-row-1").click()
    await settings.click()
    await generic.getByRole("button", { name: "Compact", exact: true }).click()
    await expect(generic.getByTestId("entity-select-row-1")).toHaveAttribute("aria-checked", "true")
    await expect(search).toHaveValue("Synthetic order 1")
    await generic.getByRole("button", { name: "Saved filters", exact: true }).click()
    await page.getByTestId("entity-saved-filter-name").fill("Orders one")
    await page.getByTestId("entity-saved-filter-save").click()
    await page.keyboard.press("Escape")
    await generic.getByTestId("entity-clear-filters").click()
    await expect(generic.locator('[data-testid^="entity-row-"]')).toHaveCount(25)
    await generic.getByRole("button", { name: "Saved filters", exact: true }).click()
    await page.getByTestId("entity-saved-filter-apply-Orders one").click()
    await page.keyboard.press("Escape")
    await expect(search).toHaveValue("Synthetic order 1")
    await expect(generic.locator('[data-testid^="entity-row-"]')).toHaveCount(11)
    await generic.getByRole("button", { name: "Choose columns", exact: true }).click()
    await page.getByRole("menuitemcheckbox", { name: "Amount", exact: true }).click()
    await page.keyboard.press("Escape")
    await expect(generic.getByRole("columnheader", { name: "Amount", exact: true })).toHaveCount(0)
    await settings.click()
    await settings.focus()
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => document.activeElement?.closest('[role="region"][aria-label="View settings"]') != null)).toBe(false)
    await generic.getByTestId("entity-clear-filters").click()
    await generic.getByRole("button", { name: "Board", exact: true }).click()
    await expect(generic.getByTestId("entity-board-readonly")).toBeVisible()
    await generic.getByRole("button", { name: "Summary", exact: true }).click()
    await expect(generic.getByRole("button", { name: "Summary", exact: true })).toHaveAttribute("aria-pressed", "true")
    await generic.getByRole("button", { name: "List", exact: true }).click()
    await expect(generic.getByTestId("entity-row-40")).toBeVisible()
    for (const name of ["Customer invoices", "Vendor bills"]) {
      const section = page.getByRole("region", { name, exact: true })
      for (const control of [section.getByRole("textbox", { name: "Search", exact: true }),
        section.getByRole("combobox", { name: "Currency", exact: true }),
        section.getByRole("button", { name: "View settings", exact: true })]) {
        await expect(control).toBeVisible()
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
      await section.getByRole("textbox", { name: "Search", exact: true }).fill("no synthetic match")
      await section.getByRole("button", { name: "View settings", exact: true }).click()
      await section.getByRole("button", { name: "Compact", exact: true }).click()
      await expect(section.getByRole("textbox", { name: "Search", exact: true })).toHaveValue("no synthetic match")
      await section.getByRole("button", { name: "Clear filters", exact: true }).first().click()
      await expect(section.getByRole("textbox", { name: "Search", exact: true })).toHaveValue("")
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    expect(apiRequests).toEqual([])
  })
}
