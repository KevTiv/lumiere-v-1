export type {
  AiUiContext,
  RagUiContext,
} from "@lumiere/erp-shared/ai-ui-context"
export {
  buildRagUiContext,
  deriveErpModuleFromPathname,
  sanitizeRagUiContext,
} from "@lumiere/erp-shared/ai-ui-context"
export type { AiSourceLinkInput } from "@lumiere/erp-shared/ai-source-links"
export {
  buildModuleTabHref,
  resolveAiSourceHref,
} from "@lumiere/erp-shared/ai-source-links"

import {
  buildRagUiContext,
  deriveErpModuleFromPathname,
  summarizeEntityRow,
  type AiUiContext,
} from "@lumiere/erp-shared/ai-ui-context"

export type AiEntitySelection = {
  activeTab?: string
  entityType: string
  entityId?: string
  selectionSummary?: string
}

/** Map default @ data commands to known SearchEmbedding content_type values only. */
export const AT_COMMAND_CONTENT_TYPES: Record<string, readonly string[]> = {
  /** No sale_order embeddings yet; @sales affects ui_context.at_commands only. */
  sales: [],
  inventory: ["product"],
  customers: ["contact"],
  reports: ["document"],
  docs: ["document"],
}

export function deriveRouteContext(pathname: string): { route: string; module: string | null } {
  return deriveErpModuleFromPathname(pathname ?? "/")
}

/** Extract unique @command tokens from user text (without the @ prefix). */
export function parseAtCommands(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(/@([a-zA-Z][\w-]*)/g)) {
    const name = match[1]?.toLowerCase()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function atCommandsToIncludeTypes(commands: readonly string[]): string[] {
  const types = new Set<string>()
  for (const cmd of commands) {
    for (const t of AT_COMMAND_CONTENT_TYPES[cmd] ?? []) {
      types.add(t)
    }
  }
  return [...types]
}

export function buildAiUiContext(args: {
  pathname: string
  companyId?: number | null
  atCommands?: readonly string[]
  activeTab?: string | null
  selection?: AiEntitySelection | null
}): AiUiContext | undefined {
  return buildRagUiContext({
    pathname: args.pathname,
    activeTab: args.selection?.activeTab ?? args.activeTab,
    companyId: args.companyId,
    atCommands: args.atCommands,
    entityType: args.selection?.entityType,
    entityId: args.selection?.entityId,
    selectionSummary: args.selection?.selectionSummary,
  })
}

export function buildEntitySelection(args: {
  activeTab: string
  entityType: string
  row: Record<string, unknown>
  rowKey?: string
}): AiEntitySelection {
  const rawId = args.row[args.rowKey ?? "id"]
  const entityId = rawId == null ? undefined : String(rawId)
  return {
    activeTab: args.activeTab,
    entityType: args.entityType,
    entityId,
    selectionSummary: summarizeEntityRow(args.row),
  }
}

export {
  resolveErpCompanyId,
  summarizeEntityRow,
} from "@lumiere/erp-shared/ai-ui-context"
