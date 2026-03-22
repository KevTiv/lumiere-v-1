"use client"

import { useState, useCallback, useMemo } from "react"
import {
  posProducts,
  type POSProduct,
  type POSCartItem,
  type POSOrder,
  type POSPaymentMethod,
} from "@lumiere/ui/lib/finance-types"

export const POS_CATEGORIES = ["All", ...Array.from(new Set(posProducts.map((p) => p.category)))]

export interface UsePOSReturn {
  cart: POSCartItem[]
  search: string
  category: string
  gridMode: "grid" | "list"
  showPayment: boolean
  lastOrder: POSOrder | null
  discountCode: string
  orderDiscount: number
  filteredProducts: POSProduct[]
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  categories: string[]
  setSearch: (v: string) => void
  setCategory: (v: string) => void
  setGridMode: (v: "grid" | "list") => void
  setShowPayment: (v: boolean) => void
  setLastOrder: (order: POSOrder | null) => void
  setDiscountCode: (v: string) => void
  addToCart: (product: POSProduct) => void
  updateQty: (id: string, delta: number) => void
  removeItem: (id: string) => void
  clearCart: () => void
  applyDiscount: () => void
  handlePaymentComplete: (method: POSPaymentMethod, tendered: number) => void
}

export function usePOS(): UsePOSReturn {
  const [cart, setCart] = useState<POSCartItem[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("All")
  const [gridMode, setGridMode] = useState<"grid" | "list">("grid")
  const [showPayment, setShowPayment] = useState(false)
  const [lastOrder, setLastOrder] = useState<POSOrder | null>(null)
  const [orderCount, setOrderCount] = useState(1)
  const [discountCode, setDiscountCode] = useState("")
  const [orderDiscount, setOrderDiscount] = useState(0)

  const filteredProducts = useMemo(
    () =>
      posProducts.filter((p) => {
        const matchSearch =
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase())
        const matchCat = category === "All" || p.category === category
        return matchSearch && matchCat
      }),
    [search, category]
  )

  const addToCart = useCallback((product: POSProduct) => {
    setCart((prev) => {
      const existing = prev.find((it) => it.product.id === product.id)
      if (existing) {
        return prev.map((it) =>
          it.product.id === product.id
            ? {
                ...it,
                quantity: it.quantity + 1,
                lineTotal:
                  (it.quantity + 1) *
                  product.price *
                  (1 + product.taxRate / 100) *
                  (1 - it.discountPct / 100),
              }
            : it
        )
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          discountPct: 0,
          lineTotal: product.price * (1 + product.taxRate / 100),
        },
      ]
    })
  }, [])

  const updateQty = useCallback((id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) => {
          if (it.product.id !== id) return it
          const qty = it.quantity + delta
          if (qty <= 0) return null as unknown as POSCartItem
          return {
            ...it,
            quantity: qty,
            lineTotal:
              qty *
              it.product.price *
              (1 + it.product.taxRate / 100) *
              (1 - it.discountPct / 100),
          }
        })
        .filter(Boolean)
    )
  }, [])

  const removeItem = useCallback(
    (id: string) => setCart((prev) => prev.filter((it) => it.product.id !== id)),
    []
  )

  const clearCart = useCallback(() => {
    setCart([])
    setOrderDiscount(0)
    setDiscountCode("")
  }, [])

  const subtotal = cart.reduce((s, it) => s + it.product.price * it.quantity, 0)
  const taxTotal = cart.reduce(
    (s, it) => s + it.product.price * it.quantity * (it.product.taxRate / 100),
    0
  )
  const discountTotal = (subtotal + taxTotal) * (orderDiscount / 100)
  const total = subtotal + taxTotal - discountTotal

  const applyDiscount = useCallback(() => {
    if (discountCode.toUpperCase() === "SAVE10") setOrderDiscount(10)
    else if (discountCode.toUpperCase() === "SAVE20") setOrderDiscount(20)
  }, [discountCode])

  const handlePaymentComplete = useCallback(
    (method: POSPaymentMethod, tendered: number) => {
      const order: POSOrder = {
        id: `pos-order-${Date.now()}`,
        orderNumber: `POS-${String(orderCount).padStart(4, "0")}`,
        cashier: "Admin User",
        items: cart,
        subtotal,
        taxTotal: Math.round(taxTotal * 100) / 100,
        discountTotal: Math.round(discountTotal * 100) / 100,
        total: Math.round(total * 100) / 100,
        amountTendered: tendered,
        change: Math.max(0, tendered - total),
        paymentMethod: method,
        status: "paid",
        createdAt: new Date().toISOString(),
      }
      setLastOrder(order)
      setOrderCount((n) => n + 1)
      clearCart()
      setShowPayment(false)
    },
    [cart, orderCount, subtotal, taxTotal, discountTotal, total, clearCart]
  )

  return {
    cart,
    search,
    category,
    gridMode,
    showPayment,
    lastOrder,
    discountCode,
    orderDiscount,
    filteredProducts,
    subtotal,
    taxTotal,
    discountTotal,
    total,
    categories: POS_CATEGORIES,
    setSearch,
    setCategory,
    setGridMode,
    setShowPayment,
    setLastOrder,
    setDiscountCode,
    addToCart,
    updateQty,
    removeItem,
    clearCart,
    applyDiscount,
    handlePaymentComplete,
  }
}
