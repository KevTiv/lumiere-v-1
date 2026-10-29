import { i18n } from "@lumiere/i18n"
import type { POSProduct } from "../lib/finance-types"

/** Localize only model fallbacks; tenant names and filter values remain literal. */
export function posProductName(product: POSProduct): string {
  return product.nameIsFallback
    ? i18n.t("pos.fallback.product", { defaultValue: "Product" })
    : product.name
}

export function posCategoryName(category: string, isFallback = false): string {
  return isFallback
    ? i18n.t("pos.fallback.category", { defaultValue: "General" })
    : category
}
