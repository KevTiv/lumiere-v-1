import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { resolveAiSourceHref } from "@lumiere/erp-shared/ai-source-links"

/** Presentation intents only. The native destination owns authorization, inputs and effects. */
export type AssistantActionKind =
  | "navigate"
  | "open_record"
  | "open_form"
  | "prepare_workflow"
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
    | { kind: "navigate"; recordId?: never; prompt?: never }
    | { kind: "open_record"; recordId: string; prompt?: never }
    | { kind: "open_form"; recordId?: never; prompt?: string }
    | { kind: "prepare_workflow"; recordId: string; prompt?: string }
  )

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

interface EntityBinding {
  key: string
  module: AssistantSurface
  tab: string
  entityType: string
  label: string
  aliases: readonly string[]
  create?: true | "generate"
  review?: readonly string[]
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
  module: AssistantSurface
  tab?: string
  entityType?: string
  label: string
  permission: { resource: string; action: "read" | "create" }
}

const SURFACES: readonly AssistantSurface[] = [
  ...ALPHA_ASSISTANT_MODULES,
  ...ASSISTANT_SUPPORT_SURFACES,
]
const capabilities: AssistantCapability[] = SURFACES.map((module) => ({
  key: `${module}.navigate`,
  kind: "navigate",
  module,
  label: `Open ${module}`,
  permission: {
    resource:
      module === "products" || module === "warehouse"
        ? "module:inventory"
        : ["overview", "tasks", "settings"].includes(module)
          ? `dashboard:${module}`
          : module === "approvals"
            ? "module:workflows"
            : `module:${module}`,
    action: "read",
  },
}))
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
    label: `Open ${entity.label} list`,
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
  if (entity.review)
    capabilities.push({
      ...base,
      key: `${entity.key}.review`,
      kind: "prepare_workflow",
      label: `Review ${entity.label} workflow`,
      permission: { resource: entity.entityType, action: "read" },
    })
}

export const ALPHA_ASSISTANT_CAPABILITIES: readonly AssistantCapability[] =
  capabilities
const byKey = new Map(
  capabilities.map((capability) => [capability.key, capability]),
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
  options: { allowedModules?: readonly string[] } = {},
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
  if (
    !capability ||
    raw.kind !== capability.kind ||
    (options.allowedModules &&
      !options.allowedModules.includes(capability.module))
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
      (raw.kind !== "open_form" && raw.kind !== "prepare_workflow"))
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
  }
}

/** Destination comes exclusively from native bindings; it never authorizes reading a record. */
export function assistantActionHref(
  action: AssistantAction,
): string | undefined {
  if (!decodeAssistantAction(action, action.scope)) return undefined
  const capability = getAssistantCapability(action.capabilityKey)!
  if (action.recordId && capability.entityType) {
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
  return moduleTabHref(capability.module, capability.tab ?? "dashboard")
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
  const match =
    /^(?:(open|show(?: me)?|view|find|go to|take me to|navigate to)|(create|add|new|draft|prepare|generate|@create)|(submit|approve|confirm|post|pay|renew|amend|close|cancel|receive|validate|service|maintain|inspect|qualify|convert|review|reimburse))\s+(?:(?:a|an|the|new|existing)\s+)?(.+)$/i.exec(
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
  if (id)
    return finish(`${entity.key}.${mode === "review" ? "review" : "open"}`, id)
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
