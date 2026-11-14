import {
  fleetVehicleHref,
  invoiceRecordPageHref,
  moduleTabHref,
  ownerQueueHref,
  purchaseOrderRecordPageHref,
  saleOrderRecordPageHref,
  stockTransferRecordPageHref,
  type OwnerQueue,
} from "@lumiere/erp-shared/record-links"
import { resolveAiSourceHref } from "@lumiere/erp-shared/ai-source-links"
import {
  PERSONAL_PAGE_MODULES,
  isPersonalPageModule,
  type PersonalPageModule,
} from "@lumiere/presentation-core/personal-page-layout"

/** Presentation intents only. The native destination owns authorization, inputs and effects. */
export type AssistantActionKind =
  | "navigate"
  | "open_record"
  | "open_form"
  | "prepare_workflow"
  | "edit_page"
  | "add_widget"
export interface AssistantActionScope {
  actorId: string
  organizationId: string
  companyId: string
}

interface AssistantActionBase {
  version: 1
  capabilityKey: string
  scope: AssistantActionScope
}
/** User-authored prompts are staged instructions, never trusted field values. */
export type AssistantAction = AssistantActionBase &
  (
    | {
        kind: "navigate"
        recordId?: never
        prompt?: never
        widgetKey?: never
        pageId?: never
      }
    | {
        kind: "open_record"
        recordId: string
        prompt?: never
        widgetKey?: never
        pageId?: never
      }
    | {
        kind: "open_form"
        recordId?: never
        prompt?: string
        widgetKey?: never
        pageId?: never
      }
    | {
        kind: "prepare_workflow"
        recordId: string
        prompt?: string
        widgetKey?: never
        pageId?: never
      }
    | {
        kind: "edit_page"
        recordId?: never
        prompt?: never
        widgetKey?: never
        pageId?: string
      }
    | {
        kind: "add_widget"
        recordId?: never
        prompt?: string
        widgetKey?: string
        pageId?: string
      }
  )

export type AssistantPageAction = Extract<
  AssistantAction,
  { kind: "edit_page" | "add_widget" }
>

export interface AssistantPageWidget {
  key: string
  label: string
}

/** A native page supplies these choices; a model or stored card does not grant access. */
export interface AssistantPageCatalog {
  moduleId: string
  pageId?: string
  widgets: readonly AssistantPageWidget[]
}

export type AssistantPageContext = AssistantPageCatalog

export const ASSISTANT_PAGE_WIDGET_LIMIT = 64

export const ASSISTANT_PROMPT_LIMIT = 4000
export const ALPHA_ASSISTANT_MODULES = [
  "accounting",
  "expenses",
  "reports",
  "sales",
  "crm",
  "purchasing",
  "subscriptions",
  "products",
  "warehouse",
  "fleet",
] as const
export const ASSISTANT_SUPPORT_SURFACES = [
  "overview",
  "tasks",
  "approvals",
  "documents",
  "calendar",
  "settings",
] as const
export type AssistantSurface =
  | (typeof ALPHA_ASSISTANT_MODULES)[number]
  | (typeof ASSISTANT_SUPPORT_SURFACES)[number]

/** All shared module pages may compose widgets; business-action discovery stays Alpha scoped. */
export const ASSISTANT_PAGE_MODULES = PERSONAL_PAGE_MODULES
export type AssistantPageModule = PersonalPageModule

export function isAssistantPageModule(
  value: unknown,
): value is AssistantPageModule {
  return typeof value === "string" && isPersonalPageModule(value)
}

export function isAssistantPageAction(
  action: AssistantAction,
): action is AssistantPageAction {
  return action.kind === "edit_page" || action.kind === "add_widget"
}

function surfaceReadResource(
  module: AssistantSurface | AssistantPageModule,
): string {
  if (["products", "warehouse", "distributor"].includes(module))
    return "module:inventory"
  if (module === "trackers") return "dashboard:analytics"
  if (["overview", "tasks", "settings"].includes(module))
    return `dashboard:${module}`
  return module === "approvals" ? "module:workflows" : `module:${module}`
}

interface EntityBinding {
  key: string
  module: AssistantSurface
  tab: string
  entityType: string
  label: string
  aliases: readonly string[]
  create?: true | "generate"
  review?: readonly string[]
  reviewLabels?: Readonly<Record<string, string>>
}

/** Bindings to existing native tab owners, not a second form schema or execution registry. */
const ENTITIES: readonly EntityBinding[] = [
  {
    key: "accounting.invoice",
    module: "accounting",
    tab: "invoices",
    entityType: "account_move",
    label: "invoice",
    aliases: ["invoice", "invoices"],
    create: true,
    review: ["post", "pay", "review"],
    reviewLabels: {
      post: "Review invoice posting",
      pay: "Review invoice payment",
    },
  },
  {
    key: "accounting.bill",
    module: "accounting",
    tab: "bills",
    entityType: "account_move",
    label: "vendor bill",
    aliases: [
      "vendor bill",
      "vendor bills",
      "supplier bill",
      "supplier bills",
      "bill",
      "bills",
    ],
    create: true,
    review: ["post", "pay", "review"],
    reviewLabels: {
      post: "Review vendor bill posting",
      pay: "Review vendor bill payment",
    },
  },
  {
    key: "accounting.entry",
    module: "accounting",
    tab: "journal-entries",
    entityType: "account_move",
    label: "journal entry",
    aliases: ["journal entry", "journal entries"],
    create: true,
    review: ["post", "review"],
    reviewLabels: {
      post: "Review journal entry posting",
    },
  },
  {
    key: "expenses.expense",
    module: "expenses",
    tab: "expenses",
    entityType: "hr_expense",
    label: "expense",
    aliases: ["expense", "expenses"],
    create: true,
  },
  {
    key: "expenses.report",
    module: "expenses",
    tab: "expense-sheets",
    entityType: "hr_expense_sheet",
    label: "expense report",
    aliases: ["expense report", "expense reports"],
    create: true,
    review: ["submit", "approve", "reimburse", "review"],
    reviewLabels: {
      submit: "Review expense report submission",
      approve: "Review expense report approval",
      reimburse: "Review expense reimbursement",
    },
  },
  {
    key: "reports.report",
    module: "reports",
    tab: "reports",
    entityType: "financial_report",
    label: "report",
    aliases: ["financial report", "financial reports", "report", "reports"],
    create: "generate",
  },
  {
    key: "sales.order",
    module: "sales",
    tab: "orders",
    entityType: "sale_order",
    label: "sales order",
    aliases: [
      "sales order",
      "sales orders",
      "sale order",
      "sale orders",
      "quotation",
      "quotations",
      "quote",
      "quotes",
      "order",
      "orders",
    ],
    create: true,
    review: ["confirm", "cancel", "review"],
    reviewLabels: {
      confirm: "Review sales order confirmation",
      cancel: "Review sales order cancellation",
    },
  },
  {
    key: "crm.contact",
    module: "crm",
    tab: "contacts",
    entityType: "contact",
    label: "contact",
    aliases: [
      "contact",
      "contacts",
      "customer",
      "customers",
      "vendor",
      "vendors",
    ],
    create: true,
  },
  {
    key: "crm.lead",
    module: "crm",
    tab: "leads",
    entityType: "lead",
    label: "lead",
    aliases: ["lead", "leads"],
    create: true,
    review: ["qualify", "convert", "review"],
    reviewLabels: {
      qualify: "Review lead qualification",
      convert: "Review lead conversion",
    },
  },
  {
    key: "crm.opportunity",
    module: "crm",
    tab: "opportunities",
    entityType: "opportunity",
    label: "opportunity",
    aliases: ["opportunity", "opportunities"],
    create: true,
    review: ["convert", "review"],
    reviewLabels: {
      convert: "Review opportunity conversion",
    },
  },
  {
    key: "purchasing.order",
    module: "purchasing",
    tab: "orders",
    entityType: "purchase_order",
    label: "purchase order",
    aliases: ["purchase order", "purchase orders", "order", "orders"],
    create: true,
    review: ["confirm", "receive", "cancel", "review"],
    reviewLabels: {
      confirm: "Review purchase order confirmation",
      receive: "Review purchase receipt",
      cancel: "Review purchase order cancellation",
    },
  },
  {
    key: "subscriptions.subscription",
    module: "subscriptions",
    tab: "subscriptions",
    entityType: "subscription",
    label: "subscription",
    aliases: ["subscription", "subscriptions"],
    create: true,
    review: ["renew", "amend", "close", "cancel", "review"],
    reviewLabels: {
      renew: "Review subscription renewal",
      amend: "Review subscription amendment",
      close: "Review subscription closure",
      cancel: "Review subscription cancellation",
    },
  },
  {
    key: "products.product",
    module: "products",
    tab: "products",
    entityType: "product",
    label: "product",
    aliases: ["product", "products", "catalog item", "catalog items"],
    create: true,
  },
  {
    key: "warehouse.transfer",
    module: "warehouse",
    tab: "transfers",
    entityType: "stock_picking",
    label: "stock transfer",
    aliases: ["stock transfer", "stock transfers", "transfer", "transfers"],
    create: true,
    review: ["validate", "receive", "review"],
    reviewLabels: {
      validate: "Review stock transfer validation",
      receive: "Review stock transfer receipt",
    },
  },
  {
    key: "warehouse.count",
    module: "warehouse",
    tab: "cycle-wizard",
    entityType: "stock_cycle_count",
    label: "cycle count",
    aliases: [
      "cycle count",
      "cycle counts",
      "inventory count",
      "inventory counts",
    ],
  },
  {
    key: "warehouse.location",
    module: "warehouse",
    tab: "locations",
    entityType: "stock_location",
    label: "stock location",
    aliases: ["stock location", "stock locations", "location", "locations"],
    create: true,
  },
  {
    key: "fleet.vehicle",
    module: "fleet",
    tab: "fleet-vehicles",
    entityType: "fleet_vehicle",
    label: "vehicle",
    aliases: ["vehicle", "vehicles", "truck", "trucks"],
    create: true,
    review: ["service", "maintain", "inspect", "review"],
    reviewLabels: {
      service: "Review vehicle service",
      maintain: "Review vehicle maintenance",
      inspect: "Review vehicle inspection",
    },
  },
  {
    key: "tasks.task",
    module: "tasks",
    tab: "tasks",
    entityType: "project_task",
    label: "task",
    aliases: ["project task", "project tasks", "task", "tasks"],
    review: ["review", "edit", "assign", "reschedule"],
    reviewLabels: {
      edit: "Review task changes",
      assign: "Review task assignment",
      reschedule: "Review task due date",
    },
  },
  {
    key: "approvals.request",
    module: "approvals",
    tab: "dashboard",
    entityType: "workflow_human_task",
    label: "approval request",
    aliases: ["approval request", "approval requests", "approval"],
    review: ["review", "approve", "reject"],
    reviewLabels: {
      approve: "Review approval decision",
      reject: "Review rejection decision",
    },
  },
  {
    key: "documents.file",
    module: "documents",
    tab: "documents",
    entityType: "document",
    label: "document",
    aliases: ["document", "documents", "file", "files"],
  },
  {
    key: "documents.article",
    module: "documents",
    tab: "knowledge-base",
    entityType: "knowledge_article",
    label: "knowledge article",
    aliases: ["knowledge article", "knowledge articles", "guide", "guides"],
    create: true,
  },
  {
    key: "calendar.event",
    module: "calendar",
    tab: "events",
    entityType: "calendar_event",
    label: "calendar event",
    aliases: ["calendar event", "calendar events", "event", "events"],
    create: true,
  },
]

export interface AssistantCapability {
  key: string
  kind: AssistantActionKind
  module: AssistantSurface | AssistantPageModule
  tab?: string
  entityType?: string
  label: string
  permission: { resource: string; action: "read" | "create" }
}

const SURFACES: readonly AssistantSurface[] = [
  ...ALPHA_ASSISTANT_MODULES,
  ...ASSISTANT_SUPPORT_SURFACES,
]
const OWNER_QUEUE_ACTIONS = [
  { key: "accounting.overdue_invoices.navigate", queue: "overdueInvoices", aliases: ["overdue invoices", "overdue customer balances"], label: "Open overdue invoices", module: "accounting", resource: "account_move" },
  { key: "accounting.draft_bills.navigate", queue: "draftBills", aliases: ["draft bills", "draft vendor bills"], label: "Open draft vendor bills", module: "accounting", resource: "account_move" },
  { key: "warehouse.low_stock.navigate", queue: "lowStockProducts", aliases: ["low stock", "low stock alerts", "low-stock alerts"], label: "Open low-stock alerts", module: "warehouse", resource: "module:inventory" },
] as const satisfies readonly { key: string; queue: OwnerQueue; aliases: readonly string[]; label: string; module: AssistantSurface; resource: string }[]

const capabilities: AssistantCapability[] = SURFACES.map((module) => ({
  key: `${module}.navigate`,
  kind: "navigate",
  module,
  label: `Open ${module}`,
  permission: {
    resource: surfaceReadResource(module),
    action: "read",
  },
}))
capabilities.push({
  key: "settings.imports.navigate",
  kind: "navigate",
  module: "settings",
  tab: "imports",
  label: "Open data import",
  permission: { resource: "dashboard:settings", action: "read" },
})
for (const { key, label, module, resource } of OWNER_QUEUE_ACTIONS) {
  capabilities.push({ key, label, module, kind: "navigate", permission: { resource, action: "read" } })
}
for (const entity of ENTITIES) {
  const base = {
    module: entity.module,
    tab: entity.tab,
    entityType: entity.entityType,
  }
  capabilities.push({
    ...base,
    key: `${entity.key}.list`,
    kind: "navigate",
    label: entity.key === "warehouse.count" ? "Open cycle count wizard" : `Open ${entity.label} list`,
    permission: { resource: entity.entityType, action: "read" },
  })
  // Count wizard has no exact-record presentation contract.
  if (entity.key !== "warehouse.count")
    capabilities.push({
      ...base,
      key: `${entity.key}.open`,
      kind: "open_record",
      label: `Open ${entity.label}`,
      permission: { resource: entity.entityType, action: "read" },
    })
  if (entity.create)
    capabilities.push({
      ...base,
      key: `${entity.key}.${entity.create === "generate" ? "generate" : "create"}`,
      kind: "open_form",
      label: `${entity.create === "generate" ? "Prepare" : "Create"} ${entity.label}`,
      permission: { resource: entity.entityType, action: "create" },
    })
  if (entity.review) {
    const reviews = {
      review: `Review ${entity.label} workflow`,
      ...entity.reviewLabels,
    }
    for (const [verb, label] of Object.entries(reviews)) {
      capabilities.push({
        ...base,
        key: `${entity.key}.${verb}`,
        kind: "prepare_workflow",
        label,
        permission: { resource: entity.entityType, action: "read" },
      })
    }
  }
}

export const ALPHA_ASSISTANT_CAPABILITIES: readonly AssistantCapability[] =
  capabilities
export const ASSISTANT_PAGE_CAPABILITIES: readonly AssistantCapability[] =
  ASSISTANT_PAGE_MODULES.flatMap((module) => [
    {
      key: `${module}.page.edit`,
      kind: "edit_page" as const,
      module,
      label: `Edit ${module} page`,
      permission: {
        resource: surfaceReadResource(module),
        action: "read" as const,
      },
    },
    {
      key: `${module}.widget.add`,
      kind: "add_widget" as const,
      module,
      label: `Add widget to ${module}`,
      permission: {
        resource: surfaceReadResource(module),
        action: "read" as const,
      },
    },
  ])
export const ASSISTANT_CAPABILITIES: readonly AssistantCapability[] = [
  ...ALPHA_ASSISTANT_CAPABILITIES,
  ...ASSISTANT_PAGE_CAPABILITIES,
]
const byKey = new Map(
  ASSISTANT_CAPABILITIES.map((capability) => [capability.key, capability]),
)
export function getAssistantCapability(
  key: string,
): AssistantCapability | undefined {
  return byKey.get(key)
}

export function parseAssistantActionId(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value))
    return undefined
  return BigInt(value) <= 18446744073709551615n ? value : undefined
}

export function parseAssistantWidgetKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (/^builtin:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) return value
  return value.startsWith("saved:") && parseAssistantActionId(value.slice(6))
    ? value
    : undefined
}

export function parseAssistantPageId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    ? value
    : undefined
}

export function assistantPageHasWidget(
  page: AssistantPageCatalog | undefined,
  moduleId: string,
  widgetKey: unknown,
): boolean {
  return Boolean(
    page &&
    page.moduleId === moduleId &&
    parseAssistantWidgetKey(widgetKey) &&
    page.widgets.some((widget) => widget.key === widgetKey),
  )
}

function validScope(value: unknown): value is AssistantActionScope {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return false
  const scope = value as AssistantActionScope
  return (
    Object.keys(scope).length === 3 &&
    typeof scope.actorId === "string" &&
    !!scope.actorId.trim() &&
    scope.actorId.length <= 512 &&
    !!parseAssistantActionId(scope.organizationId) &&
    !!parseAssistantActionId(scope.companyId)
  )
}

export function sameAssistantScope(
  left: AssistantActionScope,
  right: AssistantActionScope,
): boolean {
  return (
    validScope(left) &&
    validScope(right) &&
    left.actorId === right.actorId &&
    left.organizationId === right.organizationId &&
    left.companyId === right.companyId
  )
}

/** Reject caller-controlled destinations, arbitrary parameters and captured foreign scopes. */
export function decodeAssistantAction(
  value: unknown,
  scope: AssistantActionScope,
  options: {
    allowedModules?: readonly string[]
    /** Page discovery is independent of the Alpha business-action catalog. */
    allowedPageModules?: readonly string[]
    page?: AssistantPageCatalog
  } = {},
): AssistantAction | undefined {
  if (
    !validScope(scope) ||
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return undefined
  const raw = value as AssistantAction
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "version",
          "kind",
          "capabilityKey",
          "scope",
          "recordId",
          "prompt",
          "widgetKey",
          "pageId",
        ].includes(key),
    )
  )
    return undefined
  if (
    raw.version !== 1 ||
    typeof raw.capabilityKey !== "string" ||
    !sameAssistantScope(raw.scope, scope)
  )
    return undefined
  const capability = getAssistantCapability(raw.capabilityKey)
  const allowedModules = isAssistantPageAction(raw)
    ? (options.allowedPageModules ?? options.allowedModules)
    : options.allowedModules
  if (
    !capability ||
    raw.kind !== capability.kind ||
    (allowedModules && !allowedModules.includes(capability.module))
  )
    return undefined
  if (
    raw.widgetKey !== undefined &&
    (raw.kind !== "add_widget" ||
      !parseAssistantWidgetKey(raw.widgetKey) ||
      (options.page &&
        !assistantPageHasWidget(
          options.page,
          capability.module,
          raw.widgetKey,
        )))
  )
    return undefined
  if (
    raw.pageId !== undefined &&
    ((raw.kind !== "edit_page" && raw.kind !== "add_widget") ||
      !parseAssistantPageId(raw.pageId) ||
      (options.page &&
        (options.page.moduleId !== capability.module ||
          raw.pageId !== (options.page.pageId ?? "dashboard"))))
  )
    return undefined
  const needsRecord =
    raw.kind === "open_record" || raw.kind === "prepare_workflow"
  if (
    needsRecord
      ? !parseAssistantActionId(raw.recordId)
      : raw.recordId !== undefined
  )
    return undefined
  if (
    raw.prompt !== undefined &&
    (typeof raw.prompt !== "string" ||
      !raw.prompt.trim() ||
      raw.prompt.length > ASSISTANT_PROMPT_LIMIT ||
      (raw.kind !== "open_form" &&
        raw.kind !== "prepare_workflow" &&
        raw.kind !== "add_widget"))
  )
    return undefined
  const base = {
    version: 1 as const,
    capabilityKey: capability.key,
    scope: { ...scope },
  }
  switch (capability.kind) {
    case "navigate":
      return { ...base, kind: "navigate" }
    case "open_record":
      return { ...base, kind: "open_record", recordId: raw.recordId! }
    case "open_form":
      return {
        ...base,
        kind: "open_form",
        ...(raw.prompt ? { prompt: raw.prompt } : {}),
      }
    case "prepare_workflow":
      return {
        ...base,
        kind: "prepare_workflow",
        recordId: raw.recordId!,
        ...(raw.prompt ? { prompt: raw.prompt } : {}),
      }
    case "edit_page":
      return {
        ...base,
        kind: "edit_page",
        ...(raw.pageId ? { pageId: raw.pageId } : {}),
      }
    case "add_widget":
      return {
        ...base,
        kind: "add_widget",
        ...(raw.prompt ? { prompt: raw.prompt } : {}),
        ...(raw.widgetKey ? { widgetKey: raw.widgetKey } : {}),
        ...(raw.pageId ? { pageId: raw.pageId } : {}),
      }
  }
}

/** Destination comes exclusively from native bindings; it never authorizes reading a record. */
export function assistantActionHref(
  action: AssistantAction,
): string | undefined {
  if (!decodeAssistantAction(action, action.scope)) return undefined
  const capability = getAssistantCapability(action.capabilityKey)!
  if (capability.key === "settings.imports.navigate") return "/settings?section=imports"
  const ownerQueue = OWNER_QUEUE_ACTIONS.find(({ key }) => key === capability.key)
  if (ownerQueue) return ownerQueueHref(ownerQueue.queue)
  if (capability.module === "tasks" && capability.entityType === "project_task") {
    const params = new URLSearchParams({ source: "projects" })
    if (action.recordId) {
      params.set("taskId", action.recordId)
      params.set("taskCompany", action.scope.companyId)
      if (action.kind === "prepare_workflow") {
        params.set("taskView", capability.key.endsWith(".assign") ? "assign" : "edit")
      }
    }
    return `/tasks?${params}`
  }
  if (capability.module === "approvals" && capability.entityType === "workflow_human_task" && action.recordId) {
    return `/approvals?${new URLSearchParams({
      taskId: action.recordId,
      taskCompany: action.scope.companyId,
    })}`
  }
  if (action.recordId && capability.entityType) {
    switch (capability.entityType) {
      case "account_move":
        if (capability.tab === "invoices" || capability.tab === "bills")
          return invoiceRecordPageHref(action.recordId)
        break
      case "sale_order":
        return saleOrderRecordPageHref(action.recordId)
      case "purchase_order": {
        const href = purchaseOrderRecordPageHref(action.recordId)
        return capability.key === "purchasing.order.receive" ? `${href}?tab=lines` : href
      }
      case "subscription":
        if (capability.key === "subscriptions.subscription.amend")
          return `/subscriptions/${action.recordId}?tab=amendments`
        break
    }
    if (capability.module === "warehouse" && capability.entityType === "stock_picking") {
      return action.kind === "prepare_workflow"
        ? stockTransferRecordPageHref(action.recordId, "operations")
        : moduleTabHref("warehouse", "transfers", { id: action.recordId })
    }
    if (capability.entityType === "fleet_vehicle") {
      const tab = capability.key === "fleet.vehicle.inspect" ? "inspections"
        : capability.key === "fleet.vehicle.service" || capability.key === "fleet.vehicle.maintain" ? "service"
        : undefined
      return fleetVehicleHref(action.recordId, tab)
    }
    return (
      resolveAiSourceHref({
        entity_type: capability.entityType,
        entity_id: action.recordId,
      }) ??
      moduleTabHref(capability.module, capability.tab ?? "dashboard", {
        id: action.recordId,
      })
    )
  }
  return moduleTabHref(
    capability.module,
    (isAssistantPageAction(action) ? action.pageId : capability.tab) ??
      "dashboard",
  )
}

export type AssistantActionResolution =
  | { kind: "action"; action: AssistantAction }
  | {
      kind: "clarify"
      reason:
        | "ambiguous_target"
        | "record_required"
        | "unsupported_action"
        | "scope_required"
        | "unavailable"
      candidates: string[]
    }
  | { kind: "none" }
export interface AssistantRequestContext {
  scope: AssistantActionScope
  module?: string | null
  selection?: { entityType: string; entityId?: string } | null
  allowedModules?: readonly string[]
  allowedPageModules?: readonly string[]
  page?: AssistantPageCatalog
}

/** Resolve explicit page editing separately from business-record creation. */
function resolvePageActionRequest(
  command: string,
  prompt: string,
  context: AssistantRequestContext,
): AssistantActionResolution | undefined {
  const edit =
    /^(?:edit|customi[sz]e|rearrange|personali[sz]e)\s+(?:(?:the|this|current|my)\s+)?(?:(\w+)\s+)?(?:page|dashboard|layout)(?:\s+layout)?[.!?]*$/i.exec(
      command,
    )
  const add =
    /^(?:add|insert|pin|create)\s+(?:(?:a|an|the|new|this|existing)\s+)?(?:(?:bar|line|area|pie|donut|sales|revenue|monthly|weekly|daily)\s+){0,3}(?:widget|chart|kpi|metric|table)\b/i.test(
      command,
    )
  if (!edit && !add) return undefined
  if (!validScope(context.scope))
    return { kind: "clarify", reason: "scope_required", candidates: [] }
  const target =
    edit?.[1]?.toLowerCase() ??
    ASSISTANT_PAGE_MODULES.find((module) =>
      new RegExp(
        `\\b(?:to|on|in)\\s+(?:(?:the|my)\\s+)?${module}(?:\\s+(?:page|dashboard))?(?:\\s|[.!?]|$)`,
        "i",
      ).test(command),
    ) ??
    context.module
  if (!target)
    return { kind: "clarify", reason: "ambiguous_target", candidates: [] }
  if (!isAssistantPageModule(target))
    return { kind: "clarify", reason: "unsupported_action", candidates: [] }
  const kind = edit ? "edit_page" : "add_widget"
  const matches =
    kind === "add_widget" && context.page?.moduleId === target
      ? context.page.widgets.filter((widget) => {
          const label = widget.label.trim().toLowerCase()
          return (
            parseAssistantWidgetKey(widget.key) &&
            label.length >= 3 &&
            command.toLowerCase().includes(label)
          )
        })
      : []
  const action = decodeAssistantAction(
    {
      version: 1,
      kind,
      capabilityKey: `${target}.${edit ? "page.edit" : "widget.add"}`,
      scope: context.scope,
      ...(context.page?.moduleId === target
        ? { pageId: context.page.pageId ?? "dashboard" }
        : {}),
      ...(kind === "add_widget" ? { prompt } : {}),
      ...(matches.length === 1 ? { widgetKey: matches[0]!.key } : {}),
    },
    context.scope,
    {
      allowedModules: context.allowedModules,
      allowedPageModules: context.allowedPageModules,
      page: context.page,
    },
  )
  return action
    ? { kind: "action", action }
    : { kind: "clarify", reason: "unavailable", candidates: [] }
}

/** Bounded explicit-command fallback, not a semantic planner. Unrecognized prose stays in RAG. */
export function resolveAssistantActionRequest(
  text: string,
  context: AssistantRequestContext,
): AssistantActionResolution {
  const command = text
    .trim()
    .replace(
      /^(?:please\s+|(?:can|could|would) you\s+|i (?:want|need) to\s+|let['’]s\s+)/i,
      "",
    )
  if (!command || command.length > ASSISTANT_PROMPT_LIMIT)
    return { kind: "none" }
  const pageAction = resolvePageActionRequest(command, text.trim(), context)
  if (pageAction) return pageAction
  const match =
    /^(?:(open|show(?: me)?|view|find|go to|take me to|navigate to)|(create|add|new|draft|prepare|generate|@create)|(submit|approve|confirm|post|pay|renew|amend|close|cancel|receive|validate|service|maintain|inspect|qualify|convert|review|reimburse|reject|edit|assign|reschedule))\s+(?:(?:a|an|the|new|existing)\s+)?(.+)$/i.exec(
      command,
    )
  if (!match) return { kind: "none" }
  if (!validScope(context.scope))
    return { kind: "clarify", reason: "scope_required", candidates: [] }
  const target = match[4]!
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim()
  const mode = match[1] ? "open" : match[2] ? "create" : "review"
  const verb = (match[3] ?? "").toLowerCase()
  const surface = SURFACES.find(
    (module) =>
      target === module ||
      target === `${module} page` ||
      target === `${module} module`,
  )
  const finish = (
    key: string,
    recordId?: string,
  ): AssistantActionResolution => {
    const capability = getAssistantCapability(key)
    if (!capability)
      return { kind: "clarify", reason: "unsupported_action", candidates: [] }
    const action = decodeAssistantAction(
      {
        version: 1,
        kind: capability.kind,
        capabilityKey: key,
        scope: context.scope,
        ...(recordId ? { recordId } : {}),
        ...(capability.kind === "open_form" ||
        capability.kind === "prepare_workflow"
          ? { prompt: text.trim() }
          : {}),
      },
      context.scope,
      { allowedModules: context.allowedModules },
    )
    return action
      ? { kind: "action", action }
      : { kind: "clarify", reason: "unavailable", candidates: [] }
  }
  if (surface && mode === "open") return finish(`${surface}.navigate`)
  if (mode === "open" && target === "my work") return finish("tasks.navigate")
  if (mode === "open" || verb === "review") {
    const ownerQueue = OWNER_QUEUE_ACTIONS.find(({ aliases }) => aliases.some((alias) => target === alias))
    if (ownerQueue) return finish(ownerQueue.key)
  }
  if (mode === "open" && /^(?:data import|saved imports|import settings|imports)$/.test(target)) {
    return finish("settings.imports.navigate")
  }
  const matches = ENTITIES.flatMap((entity) =>
    entity.aliases
      .filter(
        (alias) =>
          target === alias ||
          target.startsWith(`${alias} `) ||
          target.startsWith(`${alias}#`),
      )
      .map((alias) => ({ entity, alias })),
  )
  const longest = Math.max(0, ...matches.map((item) => item.alias.length))
  let candidates = matches.filter((item) => item.alias.length === longest)
  if (candidates.length > 1 && context.module) {
    const contextual = candidates.filter(
      (item) => item.entity.module === context.module,
    )
    if (contextual.length) candidates = contextual
  }
  if (!candidates.length)
    return /^(?:task|tasks|todo|todos|project|projects|manufacturing|payroll|employee|employees|rental|gps)\b/.test(
      target,
    )
      ? { kind: "clarify", reason: "unsupported_action", candidates: [] }
      : { kind: "none" }
  if (candidates.length !== 1)
    return {
      kind: "clarify",
      reason: "ambiguous_target",
      candidates: candidates.map((item) => item.entity.key),
    }
  const { entity, alias } = candidates[0]!
  const alternatives = target
    .split(/\s+(?:and|or|then|&)\s+/)
    .slice(1)
    .map((part) =>
      part.replace(
        /^(?:(?:open|show|create|add|post|pay|renew|review)\s+)?(?:(?:a|an|the)\s+)?/,
        "",
      ),
    )
  const additionalEntities = ENTITIES.filter((candidate) =>
    alternatives.some((part) =>
      candidate.aliases.some(
        (name) =>
          part === name ||
          part.startsWith(`${name} `) ||
          part.startsWith(`${name}#`),
      ),
    ),
  )
  if (additionalEntities.length)
    return {
      kind: "clarify",
      reason: "ambiguous_target",
      candidates: [
        ...new Set([
          entity.key,
          ...additionalEntities.map((candidate) => candidate.key),
        ]),
      ],
    }
  if (mode === "create")
    return finish(
      `${entity.key}.${entity.create === "generate" ? "generate" : "create"}`,
    )
  const rest = target.slice(alias.length).trim()
  if (mode === "open" && entity.key === "warehouse.count" && rest === "wizard")
    return finish(`${entity.key}.list`)
  const idMatch = /^(?:#\s*|(?:id|number)\s*#?\s*)?([1-9][0-9]*)(?:\s|$)/.exec(
    rest,
  )
  const selected =
    context.selection?.entityType === entity.entityType
      ? parseAssistantActionId(context.selection.entityId)
      : undefined
  const id = idMatch
    ? parseAssistantActionId(idMatch[1])
    : rest === ""
      ? selected
      : undefined
  if (mode === "review" && !entity.review?.includes(verb))
    return {
      kind: "clarify",
      reason: "unsupported_action",
      candidates: [`${entity.key}.list`],
    }
  if (id) {
    const capability = mode === "open"
      ? "open"
      : entity.reviewLabels && Object.hasOwn(entity.reviewLabels, verb)
        ? verb
        : "review"
    return finish(`${entity.key}.${capability}`, id)
  }
  if (
    mode === "open" &&
    (rest === "list" || rest === "page" || (alias.endsWith("s") && rest === ""))
  )
    return finish(`${entity.key}.list`)
  return {
    kind: "clarify",
    reason: "record_required",
    candidates: [`${entity.key}.list`],
  }
}
