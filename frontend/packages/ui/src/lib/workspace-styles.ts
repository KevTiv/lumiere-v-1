/**
 * Lumière's renderer-owned visual vocabulary. Static configs, runtime-merged
 * forms and persisted presentation hosts share these roles; definitions never
 * need to store colours, Tailwind classes or a second theme/schema authority.
 * See docs/plans/erp-ui-design-system-completion-plan.md, section 5.
 */
export const workspaceStyles = {
  pageHeader: "ui-page-header flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end",
  pageTitle: "ui-page-title text-foreground",
  pageDescription: "max-w-3xl text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]",
  sectionTitle: "text-sm font-semibold leading-6 tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]",
  sectionDescription: "text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]",
  surface: "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
  formSection: "min-w-0 space-y-4",
  formActions: "ui-form-actions mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-muted/30 px-4 py-3",
  actions: "ui-actions flex min-w-0 flex-wrap items-center gap-2 [&>button]:max-w-full [&>button]:whitespace-normal [&>a]:max-w-full [&>a]:whitespace-normal",
  document: "ui-document min-w-0 rounded-lg border border-border bg-card text-card-foreground shadow-sm",
  metricValue: "font-semibold tracking-tight tabular-nums text-foreground",
  workspaceNav: "flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card/60 p-1.5",
  workspaceLink: "ui-workspace-link inline-flex min-h-11 min-w-0 max-w-full items-center rounded-lg px-3 py-2 text-sm font-medium whitespace-normal [overflow-wrap:anywhere] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  workspaceLinkActive: "bg-accent text-accent-foreground ring-1 ring-primary/25",
  tabTrigger: "-mb-px h-auto min-h-11 min-w-0 max-w-full flex-none rounded-none border-0 border-b-2 border-transparent px-3 py-2 whitespace-normal [overflow-wrap:anywhere] after:hidden data-active:border-primary data-active:text-primary",
} as const
