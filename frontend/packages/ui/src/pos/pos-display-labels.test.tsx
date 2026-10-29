import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { i18n } from "@lumiere/i18n"
import type { POSProduct } from "../lib/finance-types"
import { POSPage, type POSPageProps } from "./pos-page"
import { posCategoryName, posProductName } from "./pos-display-labels"

let frenchResources: Record<string, unknown>

beforeEach(async () => {
  await i18n.changeLanguage("en")
  frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
  i18n.addResource("fr", "translation", "pos.fallback.product", "Produit traduit")
  i18n.addResource("fr", "translation", "pos.fallback.category", "Catégorie générale traduite")
  i18n.addResource("fr", "translation", "pos.categories.all", "Toutes les catégories")
})

afterEach(async () => {
  cleanup()
  i18n.removeResourceBundle("fr", "translation")
  i18n.addResourceBundle("fr", "translation", frenchResources, true, true)
  await i18n.changeLanguage("en")
})

const fallbackProduct: POSProduct = {
  id: "1", name: "Product", nameIsFallback: true, sku: "SKU-1", price: 10,
  taxRate: 0, category: "General", categoryIsFallback: true, stock: 3, imageColor: "bg-muted",
}

function pageProps(setCategory: POSPageProps["setCategory"]): POSPageProps {
  const noop = vi.fn()
  return {
    cart: [], search: "", category: "General", gridMode: "list", showPayment: false,
    lastOrder: null, discountCode: "", orderDiscount: 0, filteredProducts: [fallbackProduct],
    subtotal: 0, taxTotal: 0, discountTotal: 0, total: 0, categories: ["All", "General"],
    fallbackCategories: ["General"], terminals: [], posLifecycleError: null, isPosLifecyclePending: false,
    setSearch: noop, setCategory, setGridMode: noop, setShowPayment: noop, setLastOrder: noop,
    setDiscountCode: noop, addToCart: noop, updateQty: noop, removeItem: noop, clearCart: noop,
    applyDiscount: noop, handlePaymentComplete: noop, onOpenPosAction: noop,
  }
}

describe("POS fallback display labels", () => {
  it("translates marked fallbacks while retaining tenant names and canonical product values", async () => {
    const tenantProduct = { ...fallbackProduct, nameIsFallback: false, categoryIsFallback: false }
    await i18n.changeLanguage("fr")

    expect(posProductName(fallbackProduct)).toBe("Produit traduit")
    expect(posCategoryName(fallbackProduct.category, fallbackProduct.categoryIsFallback)).toBe("Catégorie générale traduite")
    expect(posProductName(tenantProduct)).toBe("Product")
    expect(posCategoryName(tenantProduct.category, tenantProduct.categoryIsFallback)).toBe("General")
    expect(fallbackProduct.name).toBe("Product")
    expect(fallbackProduct.category).toBe("General")
  })

  it("keeps category callback values stable after display labels change language", async () => {
    const setCategory = vi.fn()
    render(<POSPage {...pageProps(setCategory)} />)
    expect(screen.getByRole("button", { name: "All", exact: true })).toBeTruthy()

    await act(() => i18n.changeLanguage("fr"))

    expect(screen.getByText("Produit traduit")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Catégorie générale traduite", exact: true }))
    expect(setCategory).toHaveBeenLastCalledWith("General")
    fireEvent.click(screen.getByRole("button", { name: "Toutes les catégories", exact: true }))
    expect(setCategory).toHaveBeenLastCalledWith("All")
  })
})
