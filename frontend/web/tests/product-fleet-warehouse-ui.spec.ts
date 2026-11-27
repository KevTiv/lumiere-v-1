import { expect as baseExpect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const expect = baseExpect.configure({ timeout: 15_000 });

test("Warehouse switches stock and its related sources together", async ({ page }) => {
  // The dev server prewarms /product-fleet, so the first visit here compiles Inventory.
  test.setTimeout(120_000);
  const scopedResources = ["stock-quants", "stock-pickings", "stock-moves", "warehouses", "stock-locations", "stock-production-lots", "replenishment-rules"];
  const paths = new Map<string, Set<string>>();
  await page.route("**/api/query/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1)!;
    const company = url.searchParams.get("companyId") ?? "unscoped";
    if (scopedResources.includes(resource)) {
      if (!paths.has(company)) paths.set(company, new Set());
      paths.get(company)!.add(resource);
    }
    const companyId = company === "22" ? "22" : "11";
    const locationId = companyId === "22" ? "219" : "119";
    const fixtures = {
      companies: [{ id: "11", organizationId: "7" }, { id: "22", organizationId: "7" }],
      products: [{ id: "41", name: "Coffee beans", defaultCode: "COF-001", uomId: "13" }],
      uoms: [{ id: "13", name: "Unit" }],
      "stock-quants": [{
        id: `${companyId}1`, organizationId: "7", companyId, productId: "41",
        locationId, quantity: companyId === "22" ? 45 : 15, availableQuantity: companyId === "22" ? 45 : 15,
      }],
      "stock-locations": [{
        id: locationId, organizationId: "7", companyId, active: true, usage: "internal",
        name: companyId === "22" ? "Musanze Bin" : "Kigali Bin",
      }],
      warehouses: [{
        id: `${companyId}2`, organizationId: "7", companyId, active: true, lotStockId: locationId,
        inTypeId: 1, outTypeId: 2, intTypeId: 3, packTypeId: 4, pickTypeId: 5,
      }],
    };
    const data = fixtures[resource as keyof typeof fixtures] ?? [];
    await route.fulfill({ json: { data } });
  });

  await page.goto("/warehouse-company-scope");
  const warehouse = page.getByTestId("module-view-warehouse");
  await expect(warehouse.getByRole("cell", { name: "Kigali Bin", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Switch company" }).click();
  await expect(warehouse.getByRole("cell", { name: "Musanze Bin", exact: true }).first()).toBeVisible();
  await expect(warehouse.getByRole("cell", { name: "Kigali Bin", exact: true })).toHaveCount(0);
  await expect.poll(() => ["11", "22"].map((companyId) =>
    scopedResources.every((resource) => paths.get(companyId)?.has(resource)),
  )).toEqual([true, true]);
  expect(paths.has("unscoped")).toBe(false);
});

test("canvas controls fit their container and retain stock state", { tag: "@aside-fit" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto("/canvas-controls");

  const panel = page.getByRole("complementary", { name: "Stock Overview" });
  const trigger = page.getByRole("button", { name: "Stock controls" });
  const canvas = page.getByTestId("canvas-placeholder");
  const fixture = page.getByTestId("canvas-fixture");
  const search = page.getByPlaceholder("Search items by name or SKU...");
  await expect(panel).toBeVisible();
  await expect(trigger).toBeHidden();
  const canvasNode = await canvas.elementHandle();

  await search.fill("Coffee");
  await page.getByRole("button", { name: /Coffee beans.*COF-001/ }).click();
  await expect(page.getByRole("heading", { name: "Coffee beans" })).toBeVisible();

  await page.getByRole("button", { name: "Narrow workspace" }).click();
  await expect(trigger).toBeVisible();
  await expect(panel).toBeHidden();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan((await fixture.boundingBox())!.width - 4);

  await trigger.press("Enter");
  await expect(panel.getByRole("heading", { name: "Stock Overview" })).toBeFocused();
  await expect(canvas).toBeHidden();
  await panel.getByRole("button", { name: "Low Stock Only" }).click();
  const body = panel.locator('[data-slot="canvas-controls-body"]');
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(panel.getByRole("button", { name: "Close" })).toBeInViewport();

  await page.getByRole("button", { name: "Widen workspace" }).click();
  await expect(canvas).toBeVisible();
  await expect(panel.getByRole("button", { name: "Low Stock Only" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Narrow workspace" }).click();
  await panel.getByRole("button", { name: "Low Stock Only" }).press("Escape");
  await expect(trigger).toBeFocused();
  await expect(canvas).toBeVisible();
  await expect(search).toHaveValue("Coffee");
  await expect(page.getByRole("heading", { name: "Coffee beans" })).toBeVisible();
  expect(await canvasNode?.evaluate((element) => element.isConnected)).toBe(true);
});

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

test("dense tables keep aligned headings, full amounts, and keyboard disclosure", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 660 });
  await openWorkspace(page, "products", "&dense=1");
  const table = page.getByRole("table");
  const longRow = table.getByTestId("entity-row-128");
  const heading = table.getByRole("columnheader", { name: "Anschaffungskosten einschließlich Nebenkosten" });
  await expect(heading).toBeVisible();
  await expect(longRow).toContainText("1,234,567");
  const measurements = await table.evaluate((element) => {
    const table = element as HTMLTableElement;
    const viewport = table.parentElement!;
    const header = table.tHead!.rows[0]!;
    const firstRow = table.tBodies[0]!.rows[0]!;
    const cells = Array.from(header.cells).map((head, index) => {
      const body = firstRow.cells[index]!;
      return {
        offset: Math.abs(head.getBoundingClientRect().left - body.getBoundingClientRect().left),
        overflows: head.scrollWidth > head.clientWidth + 1,
      };
    });
    const before = header.getBoundingClientRect().top;
    viewport.scrollTop = 120;
    const after = header.getBoundingClientRect().top;
    const verticalScroll = viewport.scrollTop;
    viewport.scrollTop = 0;
    return { cells, before, after, verticalScroll, horizontalScroll: viewport.scrollWidth - viewport.clientWidth };
  });
  expect(measurements.cells.every(({ offset, overflows }) => offset < 1 && !overflows)).toBe(true);
  expect(measurements.verticalScroll).toBeGreaterThan(0);
  expect(Math.abs(measurements.after - measurements.before)).toBeLessThan(2);
  expect(measurements.horizontalScroll).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

  const discloseName = longRow.getByRole("button", { name: /Société internationale/ });
  await discloseName.focus();
  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog");
  await expect(popup).toContainText("systèmes hydrauliques professionnels et accessoires");
  await page.keyboard.press("Escape");
  await expect(discloseName).toBeFocused();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(table.getByText("Component 1", { exact: true })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`Inventory stock and transfer workspaces share the responsive table layout at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await openWorkspace(page, "inventory");

    const workspace = page.getByTestId("module-view-inventory");
    const overview = workspace.getByTestId(
      "module-workspace-inventory-overview",
    );
    const stock = workspace.getByTestId("module-workspace-inventory-stock");
    const movements = workspace.getByTestId(
      "module-workspace-inventory-movements",
    );
    await expect(overview).toHaveAttribute("aria-current", "page");
    await expect(
      workspace.getByTestId("module-panel-inventory-dashboard"),
    ).toBeVisible();
    await stock.press("Enter");
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "stock");
    await expect(stock).toHaveAttribute("aria-current", "page");
    const stockPanel = workspace.getByTestId("module-panel-inventory-stock");
    const stockTable = stockPanel.getByRole("table");
    await expect(stockTable).toContainText("Arabica coffee beans");
    for (const heading of ["On Hand", "Reserved", "Available", "Counted"]) {
      await expect(
        stockTable.getByRole("columnheader", { name: heading, exact: true }),
      ).toBeVisible();
    }
    const stockLayout = await stockPanel.evaluate((panel) => {
      const nav = panel
        .closest('[data-testid="module-view-inventory"]')!
        .querySelector('[data-ui="workspace-nav"]')!;
      const toolbar = panel.querySelector('[data-testid="entity-table-toolbar"]')!;
      const viewport = panel.querySelector('[data-slot="table-container"]')!;
      return {
        navBottom: nav.getBoundingClientRect().bottom,
        toolbarTop: toolbar.getBoundingClientRect().top,
        panelWidth: panel.getBoundingClientRect().width,
        viewportWidth: viewport.getBoundingClientRect().width,
        tableOverflow: viewport.scrollWidth - viewport.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(stockLayout.toolbarTop).toBeGreaterThanOrEqual(stockLayout.navBottom);
    expect(
      Math.abs(stockLayout.panelWidth - stockLayout.viewportWidth),
    ).toBeLessThanOrEqual(2);
    expect(stockLayout.documentOverflow).toBeLessThanOrEqual(1);
    if (width === 390) expect(stockLayout.tableOverflow).toBeGreaterThan(0);

    await chooseFacet(page, "Location", "Musanze / Stock");
    await expect(stockTable.getByRole("row")).toHaveCount(2);
    await expect(stockTable).toContainText("Reusable delivery crate");
    await movements.press("Enter");
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "transfers");
    await expect(movements).toHaveAttribute("aria-current", "page");
    const transfers = workspace.getByTestId("module-panel-inventory-transfers");
    await expect(
      transfers.getByRole("columnheader", { name: "Task", exact: true }),
    ).toBeVisible();
    await expect(transfers).toContainText("IN-00052");
    await page.goBack();
    await expect(page).toHaveURL((url) => url.searchParams.get("tab") === "stock");
    await expect(stockPanel).toBeVisible();

    await openWorkspace(
      page,
      "inventory",
      "&tab=stock&filter=warehouseLocationId:22",
    );
    const location = stockPanel
      .getByTestId("entity-table-toolbar")
      .getByRole("button", { name: "Location", exact: true });
    await expect(location).toContainText("Musanze / Stock");
    await expect(stockTable.getByRole("row")).toHaveCount(2);
    await location.click();
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(stockTable.getByRole("row")).toHaveCount(4);
    await expect(page).toHaveURL((url) => !url.searchParams.has("filter"));

    await openWorkspace(page, "inventory", "&tab=transfers&filter=id:52");
    await expect(movements).toHaveAttribute("aria-current", "page");
    const focusedTransfer = transfers.getByTestId("entity-row-52");
    await expect(focusedTransfer).toContainText("IN-00052");
    await expect(transfers.getByTestId("entity-active-filter-id")).toContainText(
      "id: 52",
    );
    await expect(transfers.locator('[data-testid^="entity-row-"]')).toHaveCount(1);
    await page.reload();
    await expect(focusedTransfer).toBeVisible();
    await expect(transfers.locator('[data-testid^="entity-row-"]')).toHaveCount(1);
  });

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
    ).toHaveCount(0);
    await expect(page.getByTestId("module-panel-products-products")).toBeVisible();
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
    await expect(table).toContainText("IN-00052");
    await expect(table).toContainText("OUT-00053");
    await expect(table.getByRole("columnheader", { name: "Task", exact: true })).toBeVisible();
    await chooseFacet(page, "Task", "Internal transfer");
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(table).toContainText("INT-00051");
    await expect(table).not.toContainText("IN-00052");
    await expect(table).not.toContainText("OUT-00053");
    await page.getByTestId("entity-table-toolbar").getByRole("button", { name: /Task/ }).click();
    await page.getByRole("button", { name: "Clear filter", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(table.getByRole("row")).toHaveCount(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(apiRequests).toEqual([]);
  });
}

test("Warehouse receipt focus survives denied optional locations without exposing cached task labels", async ({ page }) => {
  test.setTimeout(90_000);
  for (const locationState of ["denied", "error", "partial"]) {
    await openWorkspace(page, "warehouse", `&tab=transfers&filter=id:52&locationsState=${locationState}`);
    const table = page.locator('[role="tabpanel"]:visible').getByTestId("entity-table");
    await expect(table.getByTestId("entity-row-52")).toBeVisible();
    await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1);
    await expect(table.getByTestId("entity-active-filter-id")).toContainText("id: 52");
    await expect(table.getByTestId("entity-row-52")).toContainText("Unavailable");
    await page.reload();
    await expect(table.getByTestId("entity-row-52")).toBeVisible();
    await expect(table.getByTestId("entity-row-52")).toContainText("Unavailable");
  }
  await openWorkspace(page, "warehouse", "&tab=transfers&filter=id:52&state=denied&locationsState=ready");
  await expect(page.getByTestId("entity-row-52")).toHaveCount(0);
  await expect(page.getByText("You do not have access to these records.", { exact: true })).toBeVisible();
});

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
  await dialog.getByRole("button", { name: "Add vehicle", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Synthetic preview: no record was saved.");
  await expect(
    dialog.getByRole("textbox", { name: "Vehicle name", exact: false }),
  ).toHaveValue("Tenant delivery van");
  await expect(
    dialog.getByRole("textbox", { name: "License plate", exact: false }),
  ).toHaveValue("RAH 918 A");
});

async function fleetRecoveryFixture(page: Page, missing: "serviceType" | "journal" | "both") {
  const company = { organizationId: "7", companyId: "11" };
  const name = "Brake inspection";
  let servicePendingReadback = false;
  let canonicalTypeVisible = missing === "journal";
  let journalVisible = missing === "serviceType";
  const dispatches: { path: string; body: Record<string, unknown> }[] = [];
  let readbacks = 0;
  let releaseCanonicalRead: () => void = () => {};
  const allowCanonicalRead = new Promise<void>((resolve) => { releaseCanonicalRead = resolve; });
  await page.route("**/api/query/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1)!;
    if (resource === "fleet-service-types" && servicePendingReadback) {
      readbacks++;
      if (readbacks > 1) await allowCanonicalRead;
    }
    const data: Record<string, Record<string, unknown>[]> = {
      "fleet-vehicles": [
        { ...company, id: "71", name: "Kigali delivery van", vehicleType: "van", status: "Active" },
        {
          ...company,
          id: "72",
          name: "Musanze supply truck",
          vehicleType: "truck",
          status: "Active",
        },
      ],
      "fleet-service-types": [
        { ...company, companyId: "22", id: "190", name, isActive: true },
        ...(canonicalTypeVisible ? [{ ...company, id: "91", name, isActive: true }] : []),
      ],
      "account-journals": journalVisible
        ? [
            {
              ...company,
              id: "92",
              name: "Maintenance journal",
              code: "SERV",
              active: true,
              type: "General",
            },
          ]
        : [
            {
              ...company,
              id: "92",
              name: "Inactive journal",
              code: "OLD",
              active: false,
              type: "General",
            },
          ],
      "account-accounts": [
        {
          ...company,
          id: "93",
          name: "Maintenance expense",
          code: "5000",
          deprecated: false,
          internalGroup: "Expense",
        },
        {
          ...company,
          id: "94",
          name: "Accounts payable",
          code: "2000",
          deprecated: false,
          internalGroup: "Liability",
        },
      ],
    };
    await route.fulfill({ json: { data: data[resource] ?? [] } });
  });
  await page.route("**/api/operations/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    dispatches.push({ path, body });
    if (path.endsWith("/erp.create_company_fleet_service_type")) {
      servicePendingReadback = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({ status: 400, json: { error: "Unexpected fixture operation" } });
  });
  return {
    dispatches,
    name,
    readbackCount: () => readbacks,
    showType: () => {
      canonicalTypeVisible = true;
      releaseCanonicalRead();
    },
    showJournal: () => {
      journalVisible = true;
    },
  };
}

async function openFleetServiceRecovery(page: Page, role?: "operator") {
  await page.goto(`/fleet-service-recovery/71?tab=service${role ? `&role=${role}` : ""}`);
  await expect(page.getByTestId("vehicle-page")).toContainText("Kigali delivery van");
  await page.getByTestId("vehicle-action-service").click();
  const form = page.getByRole("dialog", { name: "Record service" });
  await expect(form).toBeVisible();
  return form;
}

test("Fleet service recovery waits for a company service type and retains the vehicle draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await fleetRecoveryFixture(page, "serviceType");
  const form = await openFleetServiceRecovery(page);
  const setup = form.getByTestId("fleet-service-setup");
  await expect(setup).toContainText("No active service type");
  await expect(setup).not.toContainText("No active journal");
  await expect(setup).not.toContainText("No active expense account");
  await expect(setup).not.toContainText("No active asset or liability account");
  const provider = form.getByTestId("form-field-provider");
  await provider.fill("Kigali garage");
  await setup.getByRole("textbox", { name: "Service type name" }).fill(`  ${fixture.name}  `);
  await setup.getByRole("button", { name: "Create service type" }).click();
  await expect.poll(() => fixture.readbackCount()).toBeGreaterThan(0);
  await expect(setup).toBeVisible();
  fixture.showType();
  await expect(setup).toHaveCount(0);
  await expect(provider).toHaveValue("Kigali garage");
  await expect(form.getByTestId("form-field-vehicle_id")).toContainText("Kigali delivery van");
  await form.getByTestId("form-field-service_type_id").click();
  await expect(page.getByRole("option", { name: fixture.name, exact: true })).toHaveCount(1);
  await expect(page).toHaveURL(/\/fleet-service-recovery\/71\?tab=service$/);
  expect(fixture.dispatches).toHaveLength(1);
  expect(fixture.dispatches[0]?.path).toBe("/api/operations/erp.create_company_fleet_service_type");
  expect(String(fixture.dispatches[0]?.body.companyId)).toBe("11");
  expect(fixture.dispatches[0]?.body.name).toBe(fixture.name);
});

test("Fleet journal recovery opens Accounting separately and refreshes the same vehicle on return", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const fixture = await fleetRecoveryFixture(page, "journal");
  await context.route("**/accounting?tab=account-journals", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Accounting journal fixture</title>" }),
  );
  const form = await openFleetServiceRecovery(page);
  const setup = form.getByTestId("fleet-service-setup");
  await expect(setup).toContainText("No active journal");
  await expect(setup).not.toContainText("No active service type");
  const provider = form.getByTestId("form-field-provider");
  await provider.fill("Kigali garage");
  const open = setup.getByRole("link", { name: "Open journals in a new tab" });
  await expect(open).toHaveAttribute("href", "/accounting?tab=account-journals");
  const [accounting] = await Promise.all([context.waitForEvent("page"), open.click()]);
  await expect(accounting).toHaveURL(/\/accounting\?tab=account-journals$/);
  fixture.showJournal();
  await accounting.close();
  await page.bringToFront();
  // Headless Chromium may omit a focus event when the fixture popup closes.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(setup).toHaveCount(0);
  await expect(provider).toHaveValue("Kigali garage");
  await expect(form.getByTestId("form-field-vehicle_id")).toContainText("Kigali delivery van");
  await expect(page).toHaveURL(/\/fleet-service-recovery\/71\?tab=service$/);
  expect(fixture.dispatches).toHaveLength(0);
});

test("Fleet operators without setup rights can see the blocker without a setup action", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fixture = await fleetRecoveryFixture(page, "both");
  const form = await openFleetServiceRecovery(page, "operator");
  const setup = form.getByTestId("fleet-service-setup");
  await expect(setup).toContainText("No active service type");
  await expect(setup).toContainText("No active journal");
  await expect(setup.getByText(/Ask an administrator/)).toHaveCount(2);
  await expect(setup.getByRole("button", { name: "Create service type" })).toHaveCount(0);
  await expect(setup.getByRole("link")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "Record service" })).toBeDisabled();
  expect(fixture.dispatches).toHaveLength(0);
});
