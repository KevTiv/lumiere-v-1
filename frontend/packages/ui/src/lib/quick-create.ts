export const QUICK_CREATE_TARGETS = {
  invoice: { module: "accounting", tab: "invoices", resource: "account_move" },
  bill: { module: "accounting", tab: "bills", resource: "account_move" },
  expense: { module: "expenses", tab: "expenses", resource: "hr_expense" },
  salesOrder: { module: "sales", tab: "orders", resource: "sale_order" },
} as const

export function quickCreateHref(action: keyof typeof QUICK_CREATE_TARGETS): string {
  const { module, tab } = QUICK_CREATE_TARGETS[action]
  return `/${module}?tab=${tab}&create=1`
}

export function quickCreateTarget(pathname: string, params: Pick<URLSearchParams, "get"> | null) {
  if (params?.get("create") !== "1") return undefined
  const tab = params.get("tab")
  return Object.values(QUICK_CREATE_TARGETS).find((target) =>
    pathname === `/${target.module}` && tab === target.tab,
  )
}

export function isQuickCreateHref(href: string): boolean {
  try {
    const url = new URL(href, "https://lumiere.invalid")
    return quickCreateTarget(url.pathname, url.searchParams) != null
  } catch {
    return false
  }
}
