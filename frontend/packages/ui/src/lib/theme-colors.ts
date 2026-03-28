/**
 * Class names backed by CSS theme tokens (see styles/theme-extended.css).
 * Prefer these over raw Tailwind palette colors (e.g. `text-blue-600`) so
 * contrast and hues can be tuned per palette / dark mode in one place.
 */

export type AccountTypeGroup =
  | "asset"
  | "liability"
  | "equity"
  | "income"
  | "expense"
  | "other"

/** RBAC / role picker — stored color name */
export type RoleColorName = "blue" | "green" | "orange" | "red" | "purple" | "teal"

/** Solid swatch (e.g. role color dot in tables) */
export const roleSwatchClass: Record<RoleColorName, string> = {
  blue: "bg-category-1",
  green: "bg-success",
  orange: "bg-warning",
  red: "bg-destructive",
  purple: "bg-category-3",
  teal: "bg-category-7",
}

/** Soft pill for role badges in tables */
export const rolePillSoftClass: Record<RoleColorName, string> = {
  blue: "bg-category-1/10 text-category-1 border-category-1/20",
  green: "bg-success/10 text-success border-success/20",
  orange: "bg-warning/10 text-warning border-warning/20",
  red: "bg-destructive/10 text-destructive border-destructive/20",
  purple: "bg-category-3/10 text-category-3 border-category-3/20",
  teal: "bg-category-7/10 text-category-7 border-category-7/20",
}

export const userStatusPillClass = {
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-destructive/10 text-destructive border-destructive/20",
  pending: "bg-warning/10 text-warning border-warning/20",
} as const

/** Audit log action keys → pill */
export const auditActionPillClass: Record<string, string> = {
  "user.login": "bg-success/10 text-success",
  "user.create": "bg-category-1/10 text-category-1",
  "role.update": "bg-category-3/10 text-category-3",
  "order.create": "bg-category-7/10 text-category-7",
  "customer.update": "bg-category-1/10 text-category-1",
  "product.update": "bg-warning/10 text-warning",
  "report.generate": "bg-category-7/10 text-category-7",
  "permission.deny": "bg-destructive/10 text-destructive",
}

/** Invoice / move status badges */
export const invoiceStatusBadgeClass = {
  cancelled: "bg-muted text-muted-foreground border-0",
  draft: "bg-secondary text-secondary-foreground border-0",
  paid: "bg-success/15 text-success border border-success/25",
  overdue: "bg-destructive/10 text-destructive border border-destructive/25",
  partial: "bg-category-3/10 text-category-3 border border-category-3/25",
  sent: "bg-info/10 text-info border border-info/25",
} as const

/** Invoice & bill list/table status pills (combined bg + text) */
export const accountingListStatusBadgeClass = {
  draft: "bg-secondary text-secondary-foreground",
  sent: "bg-info/10 text-info",
  pending: "bg-info/10 text-info",
  approved: "bg-category-6/15 text-category-6",
  partial: "bg-category-3/10 text-category-3",
  paid: "bg-success/15 text-success",
  overdue: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
} as const

/** Entry table `badge` column variants */
export const entryTableBadgeVariantClass: Record<string, string> = {
  default: "bg-secondary text-secondary-foreground",
  primary: "bg-primary/20 text-primary border-primary/30",
  secondary: "bg-secondary text-secondary-foreground",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-info/15 text-info border-info/30",
}

/** Entry table `status` column — text + icon color */
export const entryTableStatusTextClass: Record<string, string> = {
  green: "text-success",
  yellow: "text-warning",
  red: "text-destructive",
  blue: "text-info",
  gray: "text-muted-foreground",
  purple: "text-category-3",
  orange: "text-warning",
}

/** Entry table `status` column — dot */
export const entryTableStatusDotClass: Record<string, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-destructive",
  blue: "bg-info",
  gray: "bg-muted-foreground",
  purple: "bg-category-3",
  orange: "bg-warning",
}

/** Entry table progress bar fill */
export const entryTableProgressBarClass: Record<string, string> = {
  primary: "[&>div]:bg-primary",
  success: "[&>div]:bg-success",
  warning: "[&>div]:bg-warning",
  danger: "[&>div]:bg-destructive",
}

/** Forensics severity strip (solid) */
export const severitySolidBarClass = {
  red: "bg-destructive",
  orange: "bg-warning",
  yellow: "bg-accent",
  green: "bg-success",
} as const

/** Forensics status chart bars */
export const statusSolidBarClass = {
  red: "bg-destructive",
  yellow: "bg-warning",
  blue: "bg-info",
  green: "bg-success",
} as const

/** AI chat command category chips */
export const aiChatCategoryPillClass: Record<string, string> = {
  data: "bg-category-1/10 text-category-1 border-category-1/25",
  action: "bg-success/10 text-success border-success/20",
  context: "bg-category-3/10 text-category-3 border-category-3/25",
  help: "bg-warning/10 text-warning border-warning/20",
}

/** Task board — type icon color (card header) */
export const taskTypeIconClass: Record<string, string> = {
  task: "text-info",
  bug: "text-destructive",
  feature: "text-success",
  story: "text-category-3",
  epic: "text-category-1",
}

/** Task board — priority icon color */
export const taskPriorityIconClass: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-info",
  high: "text-warning",
  urgent: "text-destructive",
}

/** List view priority outline badge (urgent / high only need extra classes) */
export const taskPriorityOutlineBadgeClass: Record<string, string> = {
  low: "",
  medium: "",
  high: "border-warning text-warning",
  urgent: "border-destructive text-destructive",
}

/** Dashboard widgets — six-slot accent (quick actions, iOS tiles, activity rings, countdown) */
export type WidgetAccentKey = "blue" | "green" | "orange" | "red" | "purple" | "teal"

export const widgetAccentTileClass: Record<
  WidgetAccentKey,
  {
    bgHover: string
    icon: string
    bgSoft: string
    bar: string
    ringText: string
    stroke: string
    shadowGlow: string
  }
> = {
  blue: {
    bgHover: "bg-info/10 hover:bg-info/20",
    icon: "text-info",
    bgSoft: "bg-info/10",
    bar: "bg-info",
    ringText: "text-info",
    stroke: "stroke-info",
    shadowGlow: "group-hover:shadow-info/20",
  },
  green: {
    bgHover: "bg-success/10 hover:bg-success/20",
    icon: "text-success",
    bgSoft: "bg-success/10",
    bar: "bg-success",
    ringText: "text-success",
    stroke: "stroke-success",
    shadowGlow: "group-hover:shadow-success/20",
  },
  orange: {
    bgHover: "bg-warning/10 hover:bg-warning/20",
    icon: "text-warning",
    bgSoft: "bg-warning/10",
    bar: "bg-warning",
    ringText: "text-warning",
    stroke: "stroke-warning",
    shadowGlow: "group-hover:shadow-warning/20",
  },
  red: {
    bgHover: "bg-destructive/10 hover:bg-destructive/20",
    icon: "text-destructive",
    bgSoft: "bg-destructive/10",
    bar: "bg-destructive",
    ringText: "text-destructive",
    stroke: "stroke-destructive",
    shadowGlow: "group-hover:shadow-destructive/20",
  },
  purple: {
    bgHover: "bg-category-3/10 hover:bg-category-3/20",
    icon: "text-category-3",
    bgSoft: "bg-category-3/10",
    bar: "bg-category-3",
    ringText: "text-category-3",
    stroke: "stroke-category-3",
    shadowGlow: "group-hover:shadow-category-3/20",
  },
  teal: {
    bgHover: "bg-category-7/10 hover:bg-category-7/20",
    icon: "text-category-7",
    bgSoft: "bg-category-7/10",
    bar: "bg-category-7",
    ringText: "text-category-7",
    stroke: "stroke-category-7",
    shadowGlow: "group-hover:shadow-category-7/20",
  },
}

export const widgetCountdownGradientClass: Record<WidgetAccentKey, string> = {
  blue: "from-info/20 to-info/5 border-info/30",
  green: "from-success/20 to-success/5 border-success/30",
  orange: "from-warning/20 to-warning/5 border-warning/30",
  red: "from-destructive/20 to-destructive/5 border-destructive/30",
  purple: "from-category-3/20 to-category-3/5 border-category-3/30",
  teal: "from-category-7/20 to-category-7/5 border-category-7/30",
}

/** Countdown card bottom progress bar */
export const widgetCountdownBarClass: Record<WidgetAccentKey, string> = {
  blue: "bg-info",
  green: "bg-success",
  orange: "bg-warning",
  red: "bg-destructive",
  purple: "bg-category-3",
  teal: "bg-category-7",
}

/** Activity ring arc glow (inline filter) */
export const widgetRingGlowFilter: Record<WidgetAccentKey, string> = {
  blue: "drop-shadow(0 0 6px hsl(var(--info) / 0.25))",
  green: "drop-shadow(0 0 6px hsl(var(--success) / 0.25))",
  orange: "drop-shadow(0 0 6px hsl(var(--warning) / 0.25))",
  red: "drop-shadow(0 0 6px hsl(var(--destructive) / 0.25))",
  purple: "drop-shadow(0 0 6px hsl(var(--category-3) / 0.25))",
  teal: "drop-shadow(0 0 6px hsl(var(--category-7) / 0.25))",
}

/** Proposal product line kind tags */
export const productKindBadgeClass: Record<string, string> = {
  Service: "bg-category-1/10 text-category-1 border border-category-1/25",
  Product: "bg-success/10 text-success border border-success/25",
  Storable: "bg-warning/10 text-warning border border-warning/25",
  Consumable: "bg-category-3/10 text-category-3 border border-category-3/25",
}

export function riskLevelBadgeClass(level: string): string {
  if (level === "high") {
    return "bg-destructive/10 text-destructive border border-destructive/25"
  }
  if (level === "medium") {
    return "bg-warning/10 text-warning border border-warning/25"
  }
  return "bg-muted text-muted-foreground border border-border"
}

/** Resolve stored role color key → soft pill classes */
export function rolePillClassForColor(color: string | undefined): string {
  const k = (color ?? "blue") as RoleColorName
  return rolePillSoftClass[k] ?? rolePillSoftClass.blue
}

/** Resolve stored role color key → solid swatch (picker dot) */
export function roleSwatchClassForColor(color: string | undefined): string {
  const k = (color ?? "blue") as RoleColorName
  return roleSwatchClass[k] ?? roleSwatchClass.blue
}

/** Badge row styling for chart-of-accounts account type */
export const accountTypeBadgeClass: Record<AccountTypeGroup, string> = {
  asset: "text-category-1 border-category-1/35 bg-category-1/10",
  liability: "text-category-2 border-category-2/35 bg-category-2/10",
  equity: "text-category-3 border-category-3/35 bg-category-3/10",
  income: "text-category-4 border-category-4/35 bg-category-4/10",
  expense: "text-category-5 border-category-5/35 bg-category-5/10",
  other: "text-neutral-600 border-neutral-400/40 bg-neutral-500/10",
}

/** Summary card icon tile (background + icon color) */
export const accountTypeIconSurfaceClass: Record<AccountTypeGroup, string> = {
  asset: "bg-category-1/10 text-category-1",
  liability: "bg-category-2/10 text-category-2",
  equity: "bg-category-3/10 text-category-3",
  income: "bg-category-4/10 text-category-4",
  expense: "bg-category-5/10 text-category-5",
  other: "bg-neutral-500/10 text-neutral-600",
}

/** Forensics / generic severity chips */
export const severityBadgeClass = {
  red: "border-destructive/40 bg-destructive/10 text-destructive",
  orange: "border-warning/45 bg-warning/10 text-warning",
  yellow: "border-warning/50 bg-warning/15 text-warning",
  green: "border-success/40 bg-success/10 text-success",
} as const

/** Forensics status chips */
export const statusBadgeClass = {
  red: "border-destructive/40 bg-destructive/10 text-destructive",
  yellow: "border-warning/45 bg-warning/12 text-warning",
  blue: "border-info/40 bg-info/10 text-info",
  green: "border-success/40 bg-success/10 text-success",
} as const

/** Corrective action row status (text + soft bg) */
export const correctiveActionStatusPillClass: Record<string, string> = {
  completed: "text-success bg-success/10",
  "in-progress": "text-info bg-info/10",
  overdue: "text-destructive bg-destructive/10",
}
