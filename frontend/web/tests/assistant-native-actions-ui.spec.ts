import { expect, test } from "@playwright/test"

for (const width of [390, 1440]) {
  test(`assistant native editor retains draft, focus and URL history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const apiRequests: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url())
    })
    await page.goto("/assistant-actions?tab=dashboard")
    const open = page.getByRole("button", {
      name: "Prepare sales order",
      exact: true,
    })
    await open.click()
    await expect(page).toHaveURL(/\/assistant-actions\?tab=orders$/)
    const dialog = page.getByTestId("form-modal-assistant-fixture-order")
    await expect(dialog).toBeVisible()
    const reference = page.getByTestId("form-field-reference")
    await expect(reference).toHaveValue("")
    await reference.focus()
    await expect(reference).toBeFocused()
    await reference.fill("Retain this native draft")
    await dialog.getByRole("button", { name: /cancel/i }).click()
    await expect(page.getByTestId("discard-changes-dialog")).toBeVisible()
    await page.getByTestId("discard-changes-keep").click()
    await expect(reference).toHaveValue("Retain this native draft")
    await page.getByTestId("form-submit-assistant-fixture-order").click()
    await expect(dialog).toContainText(
      "Fixture save rejected; retain your draft. No ERP command was sent.",
    )
    await expect(reference).toHaveValue("Retain this native draft")
    await expect(page.getByTestId("fixture-native-submissions")).toHaveText("1")
    await dialog.getByRole("button", { name: /cancel/i }).click()
    await page.getByTestId("discard-changes-confirm").click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByTestId("assistant-native-action").getByRole("status"),
    ).toHaveText("Form opened")
    await expect(
      page.getByRole("link", { name: "Canonical order 42", exact: true }),
    ).toHaveAttribute("href", "/sales?tab=orders&filter=id%3A42")
    await expect(
      page.getByRole("link", { name: "Canonical order 99", exact: true }),
    ).toHaveAttribute("href", "/sales?tab=orders&filter=id%3A99")
    await page.goBack()
    await expect(page).toHaveURL(/tab=dashboard$/)
    await page.goForward()
    await expect(page).toHaveURL(/tab=orders$/)
    await expect(dialog).not.toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/tab=orders$/)
    await expect(dialog).not.toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    expect(apiRequests).toEqual([])
  })

  test(`denied permission and stale actor/company actions do not open editors at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto("/assistant-actions")
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await page
      .getByRole("button", { name: "Remove create permission", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Open fixture assistant", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Prepare sales order", exact: true })
      .click()
    await expect(
      page.getByTestId("assistant-native-action").getByRole("alert"),
    ).toContainText("This action could not be opened")
    await expect(
      page.getByTestId("form-modal-assistant-fixture-order"),
    ).toHaveCount(0)
    await expect(page.getByTestId("fixture-native-requests")).toHaveText("0")
    await page.reload()
    await page.getByRole("button", { name: "Close", exact: true }).click()
    await page
      .getByRole("button", { name: "Change actor and company", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Open fixture assistant", exact: true })
      .click()
    await page
      .getByRole("button", { name: "Prepare sales order", exact: true })
      .click()
    await expect(
      page.getByTestId("assistant-native-action").getByRole("alert"),
    ).toContainText("This action could not be opened")
    await expect(
      page.getByTestId("form-modal-assistant-fixture-order"),
    ).toHaveCount(0)
    await expect(page.getByTestId("fixture-native-requests")).toHaveText("0")
  })
}
