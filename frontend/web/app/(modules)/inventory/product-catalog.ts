import type { TFunction } from "i18next";
import type {
  EntityDetailConfig,
  EntityRow,
  EntitySurfacePermission,
  EntityViewConfig,
} from "@lumiere/ui/lib/entity-view-types";
import type { ModuleConfig } from "@lumiere/ui/lib/module-types";
import {
  getRowField,
  unwrapEntityValue,
} from "@lumiere/ui/lib/entity-row-values";

export const PRODUCT_CATALOG_TAB_IDS = [
  "products",
  "product-categories",
] as const;

// Match the existing native owners; this gates discovery, never server authority.
const CATALOG_ACTION_PERMISSIONS: Readonly<
  Record<string, EntitySurfacePermission>
> = {
  "csv-uom-category": { resource: "uom_category", action: "create" },
  "csv-uom": { resource: "uom", action: "create" },
  "csv-product-category": { resource: "product_category", action: "create" },
  "csv-product-category-tab": {
    resource: "product_category",
    action: "create",
  },
  "csv-product": { resource: "product", action: "create" },
  "csv-product-variant": { resource: "product_variant", action: "create" },
  "edit-product": { resource: "product", action: "write" },
  "delete-product": { resource: "product", action: "delete" },
  "add-variant": { resource: "product_variant", action: "create" },
  "add-supplier-line": { resource: "product_supplier_info", action: "create" },
  "add-packaging": { resource: "product_packaging", action: "create" },
  "ask-ai": { resource: "tools:ai-chat", action: "read" },
  "update-product-pricing": { resource: "product", action: "write" },
  "update-product-inventory-data": { resource: "product", action: "write" },
  "update-product-variant": { resource: "product_variant", action: "write" },
  "create-uom-category": { resource: "uom_category", action: "create" },
  "create-uom": { resource: "uom", action: "create" },
  "create-uom-conversion": { resource: "uom_conversion", action: "create" },
  "update-supplier-line": {
    resource: "product_supplier_info",
    action: "write",
  },
  "update-packaging-row": { resource: "product_packaging", action: "write" },
  "delete-category": { resource: "product_category", action: "delete" },
  "restore-category": { resource: "product_category", action: "write" },
};

const rowKey = (value: unknown): string | null => {
  const scalar = unwrapEntityValue(value);
  return typeof scalar === "string" ||
    typeof scalar === "number" ||
    typeof scalar === "bigint"
    ? String(scalar)
    : null;
};

function namesById(rows: readonly EntityRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const id = rowKey(row.id);
    const name = getRowField(row, "completeName") ?? row.name;
    if (id != null && typeof name === "string" && name.trim()) {
      names.set(id, name.trim());
    }
  }
  return names;
}

/** Display joins preserve the command's original fields and exact identifiers. */
export function productCatalogRows(
  products: readonly EntityRow[],
  categories: readonly EntityRow[],
  units: readonly EntityRow[],
): EntityRow[] {
  const categoryNames = namesById(categories);
  const unitNames = namesById(units);
  return products.map((row) => {
    const categoryId = rowKey(getRowField(row, "categId"));
    const unitId = rowKey(getRowField(row, "uomId"));
    return {
      ...row,
      defaultCode: getRowField(row, "defaultCode"),
      saleOk: getRowField(row, "saleOk"),
      purchaseOk: getRowField(row, "purchaseOk"),
      catalogCategoryId: categoryId,
      categoryName:
        categoryId == null ? null : (categoryNames.get(categoryId) ?? null),
      unitName: unitId == null ? null : (unitNames.get(unitId) ?? null),
    };
  });
}

export function productCatalogCategoryRows(
  categories: readonly EntityRow[],
): EntityRow[] {
  const names = namesById(categories);
  return categories.map((row) => {
    const parentId = rowKey(getRowField(row, "parentId"));
    return {
      ...row,
      parentName: parentId == null ? null : (names.get(parentId) ?? null),
    };
  });
}

/** A catalogue is a bounded view of Inventory's existing operation owners. */
export function productCatalogWorkspace(
  config: ModuleConfig,
  t: TFunction,
): ModuleConfig {
  return {
    ...config,
    id: "products",
    title: t("inventory.products.title"),
    description: t("inventory.products.description"),
    defaultTab: "products",
    tabGroups: undefined,
    tabNavigation: undefined,
    workspaceNav: undefined,
    workBoard: undefined,
    tabs: PRODUCT_CATALOG_TAB_IDS.flatMap((id) => {
      const source = config.tabs.find((candidate) => candidate.id === id);
      if (!source) return [];
      const tab =
        id === "product-categories"
          ? {
              ...source,
              createPermission: {
                resource: "product_category",
                action: "create" as const,
              },
            }
          : source;
      if (tab.entityConfig?.view.mode !== "table") return [tab];
      return [
        {
          ...tab,
          entityConfig: {
            ...tab.entityConfig,
            view: {
              ...tab.entityConfig.view,
              actions: tab.entityConfig.view.actions?.map((action) => {
                const permission =
                  action.permission ?? CATALOG_ACTION_PERMISSIONS[action.id];
                return permission ? { ...action, permission } : action;
              }),
              columns: tab.entityConfig.view.columns.map((column) =>
                id === "product-categories" && column.key === "parentId"
                  ? {
                      ...column,
                      key: "parentName",
                      label: t(
                        "inventory.forms.newProductCategory.fields.parentId",
                      ),
                      type: "text" as const,
                    }
                  : column,
              ),
            },
          },
        },
      ];
    }),
  };
}

/** Search and filters sit beside the catalogue; all existing commands stay attached. */
export function productCatalogTable(
  config: EntityViewConfig,
  categories: readonly EntityRow[],
  t: TFunction,
): EntityViewConfig {
  if (config.view.mode !== "table") return config;
  const name = config.view.columns.find((column) => column.key === "name");
  const remaining = config.view.columns.filter(
    (column) => column.key !== "name",
  );
  return {
    ...config,
    view: {
      ...config.view,
      searchKeys: [
        ...(config.view.searchKeys ?? []),
        "categoryName",
        "unitName",
      ],
      filters: [
        ...(config.view.filters ?? []).map((filter) =>
          filter.key === "type" ? { ...filter, faceted: true } : filter,
        ),
        {
          key: "catalogCategoryId",
          label: t("inventory.forms.newProduct.fields.categId"),
          type: "select",
          faceted: true,
          options: [...namesById(categories)].map(([value, label]) => ({
            value,
            label,
          })),
        },
        {
          key: "active",
          label: t("inventory.products.detail.active"),
          type: "select",
          faceted: true,
          options: [
            { value: "true", label: t("common.active") },
            { value: "false", label: t("common.inactive") },
          ],
        },
      ],
      columns: [
        ...(name ? [name] : []),
        ...remaining.slice(0, 1),
        {
          key: "categoryName",
          label: t("inventory.forms.newProduct.fields.categId"),
          sortable: true,
          width: "min-w-28",
        },
        {
          key: "unitName",
          label: t("inventory.forms.newProduct.fields.uomId"),
          sortable: true,
          width: "min-w-24",
        },
        ...remaining.slice(1),
        {
          key: "active",
          label: t("inventory.products.detail.active"),
          type: "status",
          badgeLabels: {
            true: t("common.active"),
            false: t("common.inactive"),
          },
          badgeVariants: { true: "success", false: "secondary" },
        },
      ],
    },
  };
}

export function productCatalogDetail(
  config: EntityDetailConfig,
  t: TFunction,
): EntityDetailConfig {
  return {
    ...config,
    sections: config.sections.map((section) =>
      section.id === "identification"
        ? {
            ...section,
            fields: [
              ...section.fields,
              ...(!section.fields.some((field) =>
                ["categId", "categoryName"].includes(field.key),
              )
                ? [
                    {
                      key: "categoryName",
                      label: t("inventory.forms.newProduct.fields.categId"),
                    },
                  ]
                : []),
              ...(!section.fields.some((field) =>
                ["uomId", "unitName"].includes(field.key),
              )
                ? [
                    {
                      key: "unitName",
                      label: t("inventory.forms.newProduct.fields.uomId"),
                    },
                  ]
                : []),
            ],
          }
        : section,
    ),
  };
}
