import type { TFunction } from "i18next";
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types";
import type { ModuleDataState } from "@lumiere/ui/lib/module-data-state";
import { toCreateProductParamsFromForm } from "@/lib/inventory-ext-params";

interface ProductPricelistReference {
  id: unknown;
  currencyId?: unknown;
  currency_id?: unknown;
}

function isValidReference(value: unknown): boolean {
  if (!["string", "number", "bigint"].includes(typeof value)) return false;
  if (typeof value === "string" && !/^\d+$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0;
}

/** A rejected preparation must keep the form open and must never report a save. */
export function prepareProductCreate(
  formData: EntityRow,
  pricelists: readonly ProductPricelistReference[],
  pricelistsState: ModuleDataState,
  t: TFunction,
) {
  if (pricelistsState.status !== "ready") {
    throw new Error(
      t("inventory.products.create.pricelistsUnavailable", {
        defaultValue:
          "Price lists could not be loaded. Retry before creating a product.",
      }),
    );
  }
  const pricelistId = formData.pricelistId;
  if (pricelistId == null || String(pricelistId).trim() === "") {
    throw new Error(
      t("inventory.products.create.pricelistRequired", {
        defaultValue: "Select a price list for this product.",
      }),
    );
  }
  const pricelist = pricelists.find(
    (row) => String(row.id) === String(pricelistId),
  );
  if (!pricelist) {
    throw new Error(
      t("inventory.products.create.pricelistUnavailable", {
        defaultValue:
          "The selected price list is no longer available. Choose another price list.",
      }),
    );
  }
  const currencyId = pricelist.currencyId ?? pricelist.currency_id;
  if (!isValidReference(currencyId)) {
    throw new Error(
      t("inventory.products.create.currencyRequired", {
        defaultValue:
          "The selected price list needs a valid currency before it can be used.",
      }),
    );
  }
  const references = [pricelistId, formData.categId, formData.uomId];
  if (formData.uomPoId != null && String(formData.uomPoId).trim() !== "")
    references.push(formData.uomPoId);
  if (!references.every(isValidReference)) {
    throw new Error(
      t("inventory.products.create.referencesRequired", {
        defaultValue:
          "Select a valid category, unit of measure and price list.",
      }),
    );
  }
  const params = toCreateProductParamsFromForm(formData, Number(currencyId));
  if (!params) {
    throw new Error(
      t("inventory.products.create.referencesRequired", {
        defaultValue:
          "Select a valid category, unit of measure and price list.",
      }),
    );
  }
  if (
    !params.name.trim() ||
    !Number.isFinite(params.standardPrice) ||
    params.standardPrice < 0
  ) {
    throw new Error(
      t("inventory.products.create.valuesRequired", {
        defaultValue: "Enter a product name and a cost of zero or more.",
      }),
    );
  }
  return params;
}
