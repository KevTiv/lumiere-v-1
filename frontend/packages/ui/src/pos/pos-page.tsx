"use client"

import { useState } from "react"
import { useTranslation } from "@lumiere/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  CreditCard,
  Banknote,
  Wallet,
  CheckCircle2,
  X,
  Receipt,
  RotateCcw,
  ChevronDown,
  Tag,
  User,
  Grid3x3,
  LayoutList,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type POSProduct,
  type POSCartItem,
  type POSOrder,
  type POSPaymentMethod,
} from "@/lib/finance-types"

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

// ── Payment Dialog ─────────────────────────────────────────────────────────────
function PaymentDialog({
  open,
  total,
  onComplete,
  onClose,
}: {
  open: boolean
  total: number
  onComplete: (method: POSPaymentMethod, tendered: number) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<POSPaymentMethod>("cash")
  const [tendered, setTendered] = useState("")
  const [done, setDone] = useState(false)

  const tenderedNum = parseFloat(tendered) || 0
  const change = Math.max(0, tenderedNum - total)

  const quickAmounts = [
    Math.ceil(total),
    Math.ceil(total / 5) * 5,
    Math.ceil(total / 10) * 10,
    Math.ceil(total / 20) * 20,
  ].filter((v, i, a) => a.indexOf(v) === i)

  const handleCharge = () => {
    setDone(true)
    setTimeout(() => {
      onComplete(method, method === "cash" ? tenderedNum : total)
      setDone(false)
      setTendered("")
    }, 1400)
  }

  const paymentMethods = [
    { id: "cash" as const, label: t("pos.payment.methods.cash"), icon: Banknote },
    { id: "card" as const, label: t("pos.payment.methods.card"), icon: CreditCard },
    { id: "split" as const, label: t("pos.payment.methods.split"), icon: Wallet },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("pos.payment.title")}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center py-10 gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-emerald-600">{t("pos.payment.complete")}</p>
            {method === "cash" && change > 0 && (
              <p className="text-lg text-muted-foreground">{t("pos.payment.change")}: <strong>{fmt(change)}</strong></p>
            )}
          </div>
        ) : (
          <>
            {/* Total */}
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground uppercase tracking-wider">{t("pos.payment.amountDue")}</p>
              <p className="text-5xl font-black text-primary mt-1">{fmt(total)}</p>
            </div>

            {/* Method selector */}
            <div className="flex gap-2">
              {paymentMethods.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMethod(id)}
                  className={cn(
                    "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-lg border-2 text-sm font-medium transition-colors",
                    method === id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Cash tendered */}
            {method === "cash" && (
              <div className="space-y-3">
                <Input
                  type="number"
                  placeholder={t("pos.payment.amountTendered")}
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  className="text-2xl h-14 text-center font-bold"
                />
                <div className="flex gap-2">
                  {quickAmounts.map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setTendered(String(amt))}
                      className="flex-1 py-2 rounded-md bg-muted hover:bg-muted/80 text-sm font-medium transition-colors"
                    >
                      {fmt(amt)}
                    </button>
                  ))}
                </div>
                {tenderedNum > 0 && (
                  <div className="flex justify-between text-sm font-medium p-3 rounded-lg bg-muted">
                    <span>{t("pos.payment.change")}</span>
                    <span className={cn(change >= 0 ? "text-emerald-600" : "text-red-500")}>
                      {fmt(change)}
                    </span>
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1">{t("common.cancel")}</Button>
              <Button
                onClick={handleCharge}
                className="flex-1 gap-2"
                disabled={method === "cash" && tenderedNum < total}
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("pos.payment.charge", { amount: fmt(total) })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Receipt Dialog ─────────────────────────────────────────────────────────────
function ReceiptDialog({ order, onClose }: { order: POSOrder | null; onClose: () => void }) {
  const { t } = useTranslation()
  if (!order) return null
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("pos.receipt.title")}</DialogTitle>
        </DialogHeader>
        <div className="font-mono text-sm space-y-3">
          <div className="text-center space-y-0.5">
            <p className="font-bold text-base">{t("pos.receipt.storeName")}</p>
            <p className="text-muted-foreground text-xs">{t("pos.receipt.storeAddress")}</p>
            <p className="text-muted-foreground text-xs">{new Date(order.createdAt).toLocaleString()}</p>
            <p className="text-xs">{t("pos.receipt.orderNumber", { number: order.orderNumber })}</p>
          </div>
          <Separator />
          {order.items.map((item) => (
            <div key={item.product.id} className="flex justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="truncate">{item.product.name}</p>
                <p className="text-muted-foreground text-xs">{item.quantity} x {fmt(item.product.price)}</p>
              </div>
              <span className="shrink-0">{fmt(item.lineTotal)}</span>
            </div>
          ))}
          <Separator />
          <div className="space-y-1">
            <div className="flex justify-between text-muted-foreground"><span>{t("pos.receipt.subtotal")}</span><span>{fmt(order.subtotal)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>{t("pos.receipt.tax")}</span><span>{fmt(order.taxTotal)}</span></div>
            <div className="flex justify-between font-bold text-base"><span>{t("pos.receipt.total")}</span><span>{fmt(order.total)}</span></div>
            {order.paymentMethod === "cash" && order.change > 0 && (
              <div className="flex justify-between text-emerald-600"><span>{t("pos.receipt.change")}</span><span>{fmt(order.change)}</span></div>
            )}
          </div>
          <Separator />
          <p className="text-center text-muted-foreground text-xs">{t("pos.receipt.thankYou")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" className="w-full" onClick={onClose}>{t("pos.receipt.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main POS Page ──────────────────────────────────────────────────────────────
export interface POSPageProps {
  className?: string
  // State
  cart: POSCartItem[]
  search: string
  category: string
  gridMode: "grid" | "list"
  showPayment: boolean
  lastOrder: POSOrder | null
  discountCode: string
  orderDiscount: number
  // Derived
  filteredProducts: POSProduct[]
  subtotal: number
  taxTotal: number
  discountTotal: number
  total: number
  categories: string[]
  // Setters
  setSearch: (v: string) => void
  setCategory: (v: string) => void
  setGridMode: (v: "grid" | "list") => void
  setShowPayment: (v: boolean) => void
  setLastOrder: (order: POSOrder | null) => void
  setDiscountCode: (v: string) => void
  // Handlers
  addToCart: (product: POSProduct) => void
  updateQty: (id: string, delta: number) => void
  removeItem: (id: string) => void
  clearCart: () => void
  applyDiscount: () => void
  handlePaymentComplete: (method: POSPaymentMethod, tendered: number) => void
}

export function POSPage({
  className,
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
}: POSPageProps) {
  const { t } = useTranslation()

  return (
    <div className={cn("flex gap-0 h-full overflow-hidden rounded-xl border bg-muted/20", className)}>

      {/* Left — Product Grid */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b bg-background">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder={t("pos.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1 p-0.5 rounded-md bg-muted">
            <Button
              variant={gridMode === "grid" ? "default" : "ghost"}
              size="icon" className="h-7 w-7"
              onClick={() => setGridMode("grid")}
            >
              <Grid3x3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={gridMode === "list" ? "default" : "ghost"}
              size="icon" className="h-7 w-7"
              onClick={() => setGridMode("list")}
            >
              <LayoutList className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 px-4 py-2.5 border-b bg-background overflow-x-auto">
          {categories.map((cat) => (
            <Button
              key={cat}
              onClick={() => setCategory(cat)}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors border",
                category === cat
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40"
              )}
            >
              {cat === "All" ? t("pos.categories.all") : cat}
            </Button>
          ))}
        </div>

        {/* Products */}
        <ScrollArea className="flex-1 p-4">
          {gridMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map((product) => (
                <button
                  type="button"
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="group rounded-xl border bg-background p-3 text-left hover:border-primary/50 hover:shadow-md transition-all active:scale-95"
                >
                  <div className={cn("w-full aspect-square rounded-lg mb-3 flex items-center justify-center text-white font-bold text-2xl", product.imageColor)}>
                    {product.name.slice(0, 1)}
                  </div>
                  <p className="text-sm font-semibold leading-tight truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{product.sku}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold text-primary">{fmt(product.price)}</span>
                    <Badge variant="secondary" className="text-xs">{t("pos.cart.left", { count: product.stock })}</Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border bg-background hover:border-primary/50 text-left transition-colors active:scale-[0.99]"
                >
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold shrink-0", product.imageColor)}>
                    {product.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.sku} · {product.category}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-primary">{fmt(product.price)}</p>
                    <p className="text-xs text-muted-foreground">{t("pos.cart.inStock", { count: product.stock })}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right — Cart */}
      <div className="w-80 shrink-0 flex flex-col border-l bg-background">
        {/* Cart header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            <span className="font-semibold">{t("pos.cart.title")}</span>
            {cart.length > 0 && (
              <Badge className="h-5 w-5 p-0 flex items-center justify-center text-xs rounded-full">
                {cart.reduce((s, it) => s + it.quantity, 0)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
              <User className="h-3.5 w-3.5" />
            </Button>
            {cart.length > 0 && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={clearCart}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Cart items */}
        <ScrollArea className="flex-1">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <ShoppingCart className="h-8 w-8 opacity-30" />
              <p className="text-sm">{t("pos.cart.empty")}</p>
              <p className="text-xs">{t("pos.cart.emptyHint")}</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {cart.map((item) => (
                <div key={item.product.id} className="flex gap-2 items-start p-2.5 rounded-lg bg-muted/40">
                  <div className={cn("w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0", item.product.imageColor)}>
                    {item.product.name.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-tight truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">{fmt(item.product.price)} {t("pos.cart.each")}</p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        onClick={() => updateQty(item.product.id, -1)}
                        className="w-5 h-5 rounded border flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-xs font-semibold w-5 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateQty(item.product.id, 1)}
                        className="w-5 h-5 rounded border flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button onClick={() => removeItem(item.product.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-semibold">{fmt(item.lineTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Discount */}
        {cart.length > 0 && (
          <div className="px-3 pb-2">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-7 h-8 text-xs"
                  placeholder={t("pos.discountCode")}
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyDiscount()}
                />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs px-2.5" onClick={applyDiscount}>
                {t("pos.apply")}
              </Button>
            </div>
            {orderDiscount > 0 && (
              <p className="text-xs text-emerald-600 mt-1 pl-1">{t("pos.cart.discountApplied", { pct: orderDiscount })}</p>
            )}
          </div>
        )}

        {/* Totals */}
        <div className="p-4 border-t space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("pos.cart.subtotal")}</span><span>{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{t("pos.cart.tax")}</span><span>{fmt(taxTotal)}</span>
          </div>
          {orderDiscount > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>{t("pos.cart.discount", { pct: orderDiscount })}</span><span>-{fmt(discountTotal)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-bold text-lg">
            <span>{t("pos.cart.total")}</span><span className="text-primary">{fmt(total)}</span>
          </div>

          {/* Charge button */}
          <Button
            className="w-full h-12 text-base gap-2 mt-2"
            disabled={cart.length === 0}
            onClick={() => setShowPayment(true)}
          >
            <CreditCard className="h-5 w-5" />
            {cart.length > 0 ? t("pos.cart.charge", { amount: fmt(total) }) : t("pos.cart.charge", { amount: "" })}
          </Button>

          {lastOrder && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs"
              onClick={() => setLastOrder(lastOrder)}
            >
              <Receipt className="h-3.5 w-3.5" />
              {t("pos.cart.reprintReceipt", { number: lastOrder.orderNumber })}
            </Button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <PaymentDialog
        open={showPayment}
        total={total}
        onComplete={handlePaymentComplete}
        onClose={() => setShowPayment(false)}
      />
      <ReceiptDialog order={lastOrder} onClose={() => setLastOrder(null)} />
    </div>
  )
}
