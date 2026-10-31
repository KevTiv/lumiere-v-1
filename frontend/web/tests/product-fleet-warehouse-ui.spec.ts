import { expect as baseExpect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const expect = baseExpect.configure({ timeout: 15_000 });

async function openWorkspace(page: Page, module: string, query = "") {
  await page.goto(`/product-fleet?module=${module}${query}`);
  await expect(page.getByTestId(`module-view-${module}`)).toHaveAttribute(
    "data-hydrated",
    "true",
  );
}

async function captureWorkspace(page: Page, module: string, width: number) {
  await page.evaluate(() => document.fonts.ready);
  const measurements = await page.evaluate(() => {
    const rectangle = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x + scrollX,
        y: bounds.y + scrollY,
        w: bounds.width,
        h: bounds.height,
      };
    };
    return {
      width: document.documentElement.scrollWidth,
      height: Math.max(innerHeight, document.documentElement.scrollHeight),
      title: rectangle("h1"),
      navigation: rectangle('[data-ui="workspace-nav"]'),
      toolbar: rectangle('[data-testid="entity-table-toolbar"]'),
      table: rectangle("table"),
    };
  });
  await page.screenshot({
    path: test.info().outputPath(`${module}-after-${width}.png`),
    fullPage: true,
  });
  await writeFile(
    test.info().outputPath(`${module}-after-${width}.json`),
    JSON.stringify(measurements, null, 2),
  );
}

async function chooseFacet(page: Page, label: string, option: string) {
  await page
    .getByTestId("entity-table-toolbar")
    .getByRole("button", { name: label, exact: true })
    .click();
  const choice = page
    .getByRole("listbox", { name: label, exact: true })
    .getByRole("option")
    .filter({ has: page.getByText(option, { exact: true }) })
    .getByRole("checkbox");
  await choice.check();
  await expect(choice).toBeChecked();
  await page.keyboard.press("Escape");
}

for (const width of [390, 1440]) {
  test(`product catalog filters and scope at ${width}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    await openWorkspace(page, "products", "&tab=warehouse-map");
    await expect(
      page.getByRole("heading", { name: "Products", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByTestId("module-tab-products-products"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByTestId("module-tab-products-warehouse-map"),
    ).toHaveCount(0);
    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(5);
    await expect(
      table.getByRole("row").filter({ hasText: "Arabica coffee beans" }),
    ).toContainText("Beverages");
    await expect(
      table.getByRole("row").filter({ hasText: "Arabica coffee beans" }),
    ).toContainText("kg");
    await captureWorkspace(page, "products", width);
    await chooseFacet(page, "Product category", "Packaging");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("Reusable delivery crate");
    await page
      .getByTestId("entity-table-toolbar")
      .getByRole("button", { name: "Product category", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Clear filter", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(table.getByRole("row")).toHaveCount(5);
    await page
      .getByRole("textbox", { name: "Search records" })
      .fill("unmatched-product");
    await expect(
      page.getByText("No matching records", { exact: false }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: "Search records" }).fill("");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    expect(apiRequests).toEqual([]);
  });
  test(`tenant vehicle filters and cost history at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    const table = page.getByRole("table");
    await openWorkspace(page, "fleet");
    await expect(table.getByRole("columnheader").first()).toHaveText(
      "Vehicle name",
    );
    await captureWorkspace(page, "fleet", width);
    await chooseFacet(page, "Status", "Maintenance");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("Musanze supply truck");
    await page.getByRole("button", { name: /Status/ }).click();
    await page
      .getByRole("button", { name: "Clear filter", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await chooseFacet(page, "Type", "van");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("RAG 281 C");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page
      .getByTestId("module-workspace-fleet-fleet-service-records")
      .click();
    await expect(table).toContainText("Scheduled maintenance");
    await expect(table).toContainText("45,000");
    await expect(table).toContainText("RWF");
    await expect(
      table.locator(
        'a[href="/accounting?tab=journal-entries&filter=id%3A9007199254740993"]',
      ),
    ).toHaveCount(1);

    expect(apiRequests).toEqual([]);
  });
  test(`warehouse quantities, filters and navigation at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    const table = page.getByRole("table");
    await openWorkspace(page, "warehouse", "&tab=products");
    await expect(
      page.getByTestId("module-tab-warehouse-stock"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("module-tab-warehouse-products")).toHaveCount(
      0,
    );
    const coffee = table
      .getByRole("row")
      .filter({ hasText: "Arabica coffee beans" });
    const headings = await table.getByRole("columnheader").allTextContents();
    for (const [heading, value] of [
      ["On Hand", "120"],
      ["Reserved", "20"],
      ["Available", "100"],
      ["Counted", "118"],
      ["Unit of measure", "kg"],
    ]) {
      const index = headings.findIndex((text) => text.trim() === heading);
      expect(index, `Missing ${heading} column`).toBeGreaterThanOrEqual(0);
      await expect(coffee.getByRole("cell").nth(index)).toHaveText(value);
    }
    await captureWorkspace(page, "warehouse", width);
    await chooseFacet(page, "Location", "Musanze / Stock");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("Reusable delivery crate");
    await page.getByTestId("module-workspace-warehouse-movements").click();
    await expect(page).toHaveURL(/tab=transfers/);
    await page.reload();
    await expect(
      page.getByTestId("module-tab-warehouse-transfers"),
    ).toHaveAttribute("aria-selected", "true");
    await expect(table).toContainText("INT-00051");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(apiRequests).toEqual([]);
  });
}

for (const module of ["products", "fleet", "warehouse"]) {
  test(`${module} distinguishes failed and denied reads from a real empty collection`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const workspace = page.getByTestId(`module-view-${module}`);
    await openWorkspace(page, module, "&state=error");
    await expect(workspace.getByRole("alert")).toContainText(
      "Records could not be loaded",
    );
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    await openWorkspace(page, module, "&state=denied");
    await expect(workspace.getByRole("status")).toContainText(
      "You do not have access to these records",
    );
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    await openWorkspace(page, module, "&empty=1");
    await expect(workspace.getByRole("alert")).toHaveCount(0);
    await expect(workspace.getByRole("status")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Search records" }),
    ).toBeVisible();
  });
}

test("failed vehicle submission retains the form and entered identity", async ({
  page,
}) => {
  await openWorkspace(page, "fleet");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Vehicle name", exact: false })
    .fill("Tenant delivery van");
  await dialog
    .getByRole("textbox", { name: "License plate", exact: false })
    .fill("RAH 918 A");
  await dialog.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Synthetic preview: no record was saved.");
  await expect(
    dialog.getByRole("textbox", { name: "Vehicle name", exact: false }),
  ).toHaveValue("Tenant delivery van");
  await expect(
    dialog.getByRole("textbox", { name: "License plate", exact: false }),
  ).toHaveValue("RAH 918 A");
});
