import assert from "node:assert/strict";
import test from "node:test";
import type { TFunction } from "i18next";
import type { EntityViewConfig } from "@lumiere/ui/lib/entity-view-types";
import type { ModuleConfig } from "@lumiere/ui/lib/module-types";
import { moduleTabDestination } from "@/lib/module-tab-navigation";
import {
  PRODUCT_CATALOG_TAB_IDS,
  productCatalogCategoryRows,
  productCatalogDetail,
  productCatalogRows,
  productCatalogTable,
  productCatalogWorkspace,
} from "./product-catalog";

const t = ((key: string) => key) as TFunction;

test("catalogue joins keep exact IDs, source quantities and prices while accepting both field conventions", () => {
  const source = {
    id: "90071992547409931",
    name: "Coffee",
    categ_id: "90071992547409932",
    uom_id: 3n,
    default_code: "COF-1",
    sale_ok: false,
    purchase_ok: true,
    standard_price: "4800.125",
    qty_available: 0,
  };
  const rows = productCatalogRows(
    [source, { id: 2n, categId: 7n, uomId: 3n, saleOk: true }],
    [
      { id: "90071992547409932", complete_name: "Food / Coffee" },
      { id: 7n, name: "Services" },
    ],
    [{ id: 3n, name: "Kilogram" }],
  );
  assert.equal(rows[0]?.id, source.id);
  assert.equal(rows[0]?.catalogCategoryId, source.categ_id);
  assert.equal(rows[0]?.categoryName, "Food / Coffee");
  assert.equal(rows[0]?.unitName, "Kilogram");
  assert.equal(rows[0]?.defaultCode, "COF-1");
  assert.equal(rows[0]?.saleOk, false);
  assert.equal(rows[0]?.purchaseOk, true);
  assert.equal(rows[0]?.standard_price, "4800.125");
  assert.equal(rows[0]?.qty_available, 0);
  assert.equal(rows[1]?.categoryName, "Services");
  assert.equal(rows[1]?.saleOk, true);
  assert.equal("categoryName" in source, false);
});

test("unknown or withheld references and flags stay unknown, without made-up categories or active states", () => {
  const [row] = productCatalogRows(
    [{ id: 1n, categId: 88n, uomId: null }],
    [],
    [],
  );
  assert.equal(row?.categoryName, null);
  assert.equal(row?.unitName, null);
  assert.equal(row?.saleOk, undefined);
  assert.equal(row?.purchaseOk, undefined);
  assert.equal(row?.active, undefined);
});

test("category filters use exact IDs even when labels repeat and table actions remain the original owners", () => {
  const action = { id: "import", label: "Import", onClick: () => undefined };
  const typeOptions = [
    { value: "product", label: "Goods" },
    { value: "consu", label: "Consumable" },
    { value: "service", label: "Service" },
  ];
  const base: EntityViewConfig = {
    id: "products",
    title: "Products",
    view: {
      mode: "table",
      rowKey: "id",
      actions: [action],
      columns: [
        { key: "defaultCode", label: "SKU" },
        { key: "name", label: "Name" },
        { key: "standardPrice", label: "Cost" },
      ],
      searchKeys: ["name", "defaultCode"],
      filters: [
        { key: "type", label: "Type", type: "select", options: typeOptions },
      ],
    },
  };
  const result = productCatalogTable(
    base,
    [
      { id: 1n, name: "General" },
      { id: 2n, name: "General" },
    ],
    t,
  );
  assert.equal(result.view.mode, "table");
  if (result.view.mode !== "table") return;
  assert.equal(result.view.actions?.[0], action);
  assert.equal(result.view.columns[0]?.key, "name");
  assert.deepEqual(
    result.view.filters?.map((filter) => filter.key),
    ["type", "catalogCategoryId", "active"],
  );
  assert.ok(result.view.filters?.every((filter) => filter.faceted === true));
  assert.equal(result.view.filters?.[0]?.options, typeOptions);
  assert.deepEqual(result.view.filters?.[1]?.options, [
    { value: "1", label: "General" },
    { value: "2", label: "General" },
  ]);
  assert.deepEqual(
    result.view.filters?.[2]?.options?.map((option) => option.value),
    ["true", "false"],
  );
  assert.ok(result.view.searchKeys?.includes("categoryName"));
  assert.ok(result.view.searchKeys?.includes("unitName"));
  assert.equal(
    base.view.mode === "table" && base.view.columns[0]?.key,
    "defaultCode",
  );
});

test("catalogue workspace preserves product form, action and record-tab identity while excluding warehouse routes", () => {
  const productTab: ModuleConfig["tabs"][number] = {
    id: "products",
    label: "Products",
    type: "entity",
    createAction: "createProduct",
    recordSheet: {
      titleKey: "name",
      detailConfig: { mode: "detail", sections: [] },
      customTabs: [
        { id: "packaging", label: "Packaging", content: () => null },
      ],
    },
  };
  const source: ModuleConfig = {
    id: "inventory",
    title: "Inventory",
    defaultTab: "dashboard",
    tabs: [
      { id: "dashboard", label: "Overview", type: "dashboard" },
      productTab,
      { id: "product-categories", label: "Categories", type: "entity" },
      { id: "transfers", label: "Transfers", type: "entity" },
    ],
    tabGroups: [{ label: "Stock", tabIds: ["products", "stock"] }],
    workspaceNav: {
      label: "Inventory",
      workspaces: [{ id: "stock", label: "Stock", tabIds: ["stock"] }],
    },
  };
  const result = productCatalogWorkspace(source, t);
  assert.equal(result.id, "products");
  assert.equal(result.defaultTab, "products");
  assert.deepEqual(
    result.tabs.map((tab) => tab.id),
    PRODUCT_CATALOG_TAB_IDS,
  );
  assert.equal(result.tabs[0], productTab);
  assert.equal(result.tabs[0]?.recordSheet, productTab.recordSheet);
  assert.equal(result.workspaceNav, undefined);
  assert.equal(result.tabGroups, undefined);
  assert.equal(source.tabs.length, 4);
  assert.equal(
    moduleTabDestination({
      pathname: "/products",
      query: "",
      tab: "transfers",
      defaultTab: "products",
      validTabs: PRODUCT_CATALOG_TAB_IDS,
    }),
    null,
  );
  assert.equal(
    moduleTabDestination({
      pathname: "/products",
      query: "company=4&filter=id:2",
      tab: "product-categories",
      defaultTab: "products",
      validTabs: PRODUCT_CATALOG_TAB_IDS,
    }),
    "/products?company=4&tab=product-categories",
  );
});

test("category parent labels are joined without replacing parent identifiers", () => {
  const rows = productCatalogCategoryRows([
    { id: 1n, name: "Food" },
    { id: 2n, name: "Coffee", parent_id: 1n },
    { id: 3n, parentId: 99n },
  ]);
  assert.equal(rows[1]?.parentName, "Food");
  assert.equal(rows[1]?.parent_id, 1n);
  assert.equal(rows[0]?.parentName, null);
  assert.equal(rows[2]?.parentName, null);
});

test("catalogue record details retain their existing sections and add the same named references as the list", () => {
  const price = {
    id: "pricing",
    fields: [{ key: "standardPrice", label: "Cost" }],
  };
  const result = productCatalogDetail(
    {
      mode: "detail",
      sections: [
        {
          id: "identification",
          fields: [{ key: "defaultCode", label: "SKU" }],
        },
        price,
      ],
    },
    t,
  );
  assert.deepEqual(
    result.sections[0]?.fields.map((field) => field.key),
    ["defaultCode", "categoryName", "unitName"],
  );
  assert.equal(result.sections[1], price);
  assert.deepEqual(productCatalogDetail(result, t), result);
});

test("catalogue create and row actions carry their native resource permissions without changing dispatch", () => {
  const save = () => undefined;
  const base: ModuleConfig = {
    id: "inventory",
    title: "Inventory",
    tabs: [
      {
        id: "products",
        label: "Products",
        type: "entity",
        entityConfig: {
          id: "products",
          title: "Products",
          view: {
            mode: "table",
            columns: [],
            actions: [
              { id: "edit-product", label: "Edit", onClick: save },
              { id: "add-packaging", label: "Packaging", onClick: save },
              { id: "csv-product", label: "Import", onClick: save },
            ],
          },
        },
      },
      {
        id: "product-categories",
        label: "Categories",
        type: "entity",
        createAction: "createProductCategory",
        entityConfig: {
          id: "categories",
          title: "Categories",
          view: {
            mode: "table",
            columns: [{ key: "parentId", label: "Parent ID" }],
            actions: [
              { id: "delete-category", label: "Delete", onClick: save },
              { id: "rename-category", label: "Rename", onClick: save },
            ],
          },
        },
      },
    ],
  };
  const result = productCatalogWorkspace(base, t);
  assert.deepEqual(result.tabs[1]?.createPermission, {
    resource: "product_category",
    action: "create",
  });
  const products = result.tabs[0]?.entityConfig?.view;
  if (products?.mode !== "table") assert.fail("Expected the product table");
  assert.deepEqual(
    products.actions?.map((action) => action.permission),
    [
      { resource: "product", action: "write" },
      { resource: "product_packaging", action: "create" },
      { resource: "product", action: "create" },
    ],
  );
  assert.ok(products.actions?.every((action) => action.onClick === save));
  const categories = result.tabs[1]?.entityConfig?.view;
  if (categories?.mode !== "table") assert.fail("Expected the category table");
  assert.deepEqual(categories.actions?.[1]?.permission, { resource: "product_category", action: "write" });
  assert.deepEqual(categories.actions?.[0]?.permission, {
    resource: "product_category",
    action: "delete",
  });
  assert.equal(categories.columns[0]?.key, "parentName");
});
