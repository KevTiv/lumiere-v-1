"use client"

import { useState, useCallback, useMemo } from "react"
import {
  posProducts,
  type POSProduct,
  type POSCartItem,
  type POSOrder,
  type POSPaymentMethod,
} from "@lumiere/ui/lib/finance-types"
import { useProducts } from "@lumiere/query-hooks/hooks/inventory"
import {
  useActivatePosConfig,
  useClosePosSession,
  useComputePosSessionTotals,
  useCreatePosConfig,
  useCreatePosOrder,
  useCreatePosTerminal,
  useDeactivatePosConfig,
  useOpenPosSession,
  usePosTerminals,
  useUpdatePosTerminal,
} from "@lumiere/query-hooks/hooks/pos"

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
  terminals: Record<string, unknown>[]
  posLifecycleError: string | null
  isPosLifecyclePending: boolean
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
  createTerminal: (data: Record<string, unknown>) => Promise<void>
  updatePrimaryTerminal: (data: Record<string, unknown>) => Promise<void>
  createDefaultConfig: (data: Record<string, unknown>) => Promise<void>
  activateConfig: (data: Record<string, unknown>) => Promise<void>
  deactivateConfig: (data: Record<string, unknown>) => Promise<void>
  openSession: (data: Record<string, unknown>) => Promise<void>
  closeSession: (data: Record<string, unknown>) => Promise<void>
  computeSessionTotals: (data: Record<string, unknown>) => Promise<void>
}

function toColor(seed: string): string {
  const palette = [
    "bg-info",
    "bg-category-1",
    "bg-category-3",
    "bg-neutral-500",
    "bg-warning",
    "bg-success",
    "bg-accent",
    "bg-category-7",
    "bg-destructive",
    "bg-primary",
    "bg-category-5",
  ]
  let acc = 0
  for (let i = 0; i < seed.length; i += 1) {
    acc = (acc + seed.charCodeAt(i)) % palette.length
  }
  return palette[acc]
}

function toPosProduct(row: Record<string, unknown>): POSProduct {
  const id = String(row.id ?? row.productTmplId ?? "")
  const name = String(row.name ?? "Product")
  const sku = String(row.defaultCode ?? row.sku ?? `SKU-${id}`)
  const listPrice = Number(row.listPrice ?? row.price ?? 0)
  const taxRate = Number(row.taxRate ?? row.saleTaxRate ?? 0)
  const category = String(row.categoryName ?? row.category ?? "General")
  const stock = Number(row.qtyAvailable ?? row.virtualAvailable ?? row.stock ?? 0)
  return {
    id,
    name,
    sku,
    price: Number.isFinite(listPrice) ? listPrice : 0,
    taxRate: Number.isFinite(taxRate) ? taxRate : 0,
    category,
    stock: Number.isFinite(stock) ? Math.max(0, stock) : 0,
    imageColor: toColor(id || name),
  }
}

export function usePOS(
  organizationId: bigint,
  companyId: bigint,
  initialProducts?: Record<string, unknown>[],
  initialTerminals?: Record<string, unknown>[]
): UsePOSReturn {
  const [cart, setCart] = useState<POSCartItem[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("All")
  const [gridMode, setGridMode] = useState<"grid" | "list">("grid")
  const [showPayment, setShowPayment] = useState(false)
  const [lastOrder, setLastOrder] = useState<POSOrder | null>(null)
  const [orderCount, setOrderCount] = useState(1)
  const [discountCode, setDiscountCode] = useState("")
  const [orderDiscount, setOrderDiscount] = useState(0)
  const [posLifecycleError, setPosLifecycleError] = useState<string | null>(null)

  const { data: productRows = [] } = useProducts(organizationId, initialProducts)
  const { data: terminals = [] } = usePosTerminals(organizationId, initialTerminals)
  const createPosOrder = useCreatePosOrder(organizationId)
  const createPosTerminal = useCreatePosTerminal(organizationId)
  const updatePosTerminal = useUpdatePosTerminal(organizationId)
  const createPosConfig = useCreatePosConfig(organizationId, companyId)
  const activatePosConfig = useActivatePosConfig(organizationId)
  const deactivatePosConfig = useDeactivatePosConfig(organizationId)
  const openPosSession = useOpenPosSession(organizationId)
  const closePosSession = useClosePosSession(organizationId)
  const computePosSessionTotals = useComputePosSessionTotals(organizationId)

  const isPosLifecyclePending =
    createPosTerminal.isPending ||
    updatePosTerminal.isPending ||
    createPosConfig.isPending ||
    activatePosConfig.isPending ||
    deactivatePosConfig.isPending ||
    openPosSession.isPending ||
    closePosSession.isPending ||
    computePosSessionTotals.isPending

  const liveProducts = useMemo(() => {
    if (productRows.length === 0) return posProducts
    return productRows.map((row) => toPosProduct(row as Record<string, unknown>))
  }, [productRows])

  const filteredProducts = useMemo(
    () =>
      liveProducts.filter((p) => {
        const matchSearch =
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase())
        const matchCat = category === "All" || p.category === category
        return matchSearch && matchCat
      }),
    [liveProducts, search, category]
  )

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(liveProducts.map((p) => p.category)))],
    [liveProducts]
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

  const firstTerminal = terminals[0] as Record<string, unknown> | undefined
  const requireNumericId = useCallback((value: unknown, label: string) => {
    const trimmed = String(value ?? "").trim()
    if (!trimmed) throw new Error(`${label} is required`)
    return trimmed
  }, [])

  const runLifecycle = useCallback(async (fn: () => Promise<void>) => {
    setPosLifecycleError(null)
    try {
      await fn()
    } catch (e) {
      setPosLifecycleError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }, [])

  const createTerminal = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await createPosTerminal.mutateAsync({
          name: String(data.name ?? "POS Terminal"),
          locationLabel: data.locationLabel ?? null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        })
      }),
    [createPosTerminal, runLifecycle],
  )

  const updatePrimaryTerminal = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        const terminalId = firstTerminal?.id
        if (terminalId == null) throw new Error("Create or select a POS terminal first")
        await updatePosTerminal.mutateAsync({
          terminalId: String(terminalId),
          status: String(data.status ?? "open"),
          dailyRevenue: Number(data.dailyRevenue) || 0,
          openOrders: Number(data.openOrders) || 0,
        })
      }),
    [firstTerminal, runLifecycle, updatePosTerminal],
  )

  const createDefaultConfig = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await createPosConfig.mutateAsync({
          name: String(data.name ?? "Default POS Config"),
          companyId,
          isActive: data.isActive ?? true,
          currencyId: null,
          journalId: null,
          warehouseId: null,
          pricelistId: null,
        })
      }),
    [companyId, createPosConfig, runLifecycle],
  )

  const activateConfig = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await activatePosConfig.mutateAsync(requireNumericId(data.configId, "Config ID"))
      }),
    [activatePosConfig, requireNumericId, runLifecycle],
  )

  const deactivateConfig = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await deactivatePosConfig.mutateAsync(requireNumericId(data.configId, "Config ID"))
      }),
    [deactivatePosConfig, requireNumericId, runLifecycle],
  )

  const openSession = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await openPosSession.mutateAsync({
          configId: requireNumericId(data.configId, "Config ID"),
          openingBalance: Number(data.openingBalance) || 0,
        })
      }),
    [openPosSession, requireNumericId, runLifecycle],
  )

  const closeSession = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await closePosSession.mutateAsync({
          sessionId: requireNumericId(data.sessionId, "Session ID"),
          closingBalance: Number(data.closingBalance) || 0,
        })
      }),
    [closePosSession, requireNumericId, runLifecycle],
  )

  const computeSessionTotals = useCallback(
    (data: Record<string, unknown>) =>
      runLifecycle(async () => {
        await computePosSessionTotals.mutateAsync(requireNumericId(data.sessionId, "Session ID"))
      }),
    [computePosSessionTotals, requireNumericId, runLifecycle],
  )

  const handlePaymentComplete = useCallback(
    (method: POSPaymentMethod, tendered: number) => {
      const primaryTerminalId =
        terminals.length > 0 ? String((terminals[0] as Record<string, unknown>).id ?? "") : null

      // Persist POS checkout through SpacetimeDB reducer coverage path.
      createPosOrder.mutate({
        company_id: null,
        terminal_id: primaryTerminalId,
        payment_method: method,
        amount_tendered: tendered,
        discount_pct: orderDiscount,
        lines: cart.map((item) => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.product.price,
          tax_rate: item.product.taxRate,
          discount_pct: item.discountPct,
        })),
      })

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
    [cart, terminals, createPosOrder, orderDiscount, orderCount, subtotal, taxTotal, discountTotal, total, clearCart]
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
    categories,
    terminals: terminals as Record<string, unknown>[],
    posLifecycleError,
    isPosLifecyclePending,
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
    createTerminal,
    updatePrimaryTerminal,
    createDefaultConfig,
    activateConfig,
    deactivateConfig,
    openSession,
    closeSession,
    computeSessionTotals,
  }
}
