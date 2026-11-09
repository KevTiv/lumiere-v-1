/**
 * Shared RAG-request preparation for the non-streaming and streaming RAG routes.
 */
import { NextResponse } from "next/server"
import { z } from "zod"

import { sanitizeRagUiContext } from "@lumiere/erp-shared/ai-ui-context"
import type { ApiSession } from "@/lib/api-session"

import type { JsonObject } from "./route-helpers"
import {
  boundedInteger,
  positiveInteger,
  validateCompanyScope,
} from "./route-helpers"
import {
  parseRagGuideReferences,
  type RagGuideReference,
} from "./guide-references"
import {
  parseRagImportTaskReferences,
  type RagImportTaskReference,
} from "./import-task-references"
import {
  serverRagUiActionOffers,
  type RagUiActionOffer,
} from "./rag-ui-actions"
import { serverRagPageCatalog } from "./rag-page-catalog"
import {
  parseRagAgentSelection,
  type RagAgentSelection,
} from "../rag/agent-selection"

export const MAX_INCLUDE_TYPES = 8

/**
 * Sanitize the `include_types` array: normalize to lowercase snake_case,
 * deduplicate, cap at MAX_INCLUDE_TYPES.
 */
export function sanitizeIncludeTypes(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined

  const seen = new Set<string>()
  const out: string[] = []

  for (const value of raw) {
    if (typeof value !== "string") continue
    const normalized = value.trim().toLowerCase().replaceAll("-", "_")
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
    if (out.length >= MAX_INCLUDE_TYPES) break
  }

  return out.length > 0 ? out : undefined
}

const sourceId = z.string().regex(/^[1-9][0-9]{0,19}$/)
const spreadsheetSelection = z
  .object({
    documentId: sourceId,
    versionId: sourceId,
    current: z.boolean(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    sheetName: z.string().min(1).max(255),
    firstRow: z.number().int().min(1).max(1_048_576),
    lastRow: z.number().int().min(1).max(1_048_576),
    firstColumn: z.number().int().min(1).max(16_384),
    lastColumn: z.number().int().min(1).max(16_384),
    delimiter: z.enum([",", ";", "\t", "|"]).optional(),
    encoding: z
      .enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"])
      .optional(),
    headerRow: z.number().int().min(1).max(1_048_576).optional(),
  })
  .strict()
  .refine(({ firstRow, lastRow, firstColumn, lastColumn, headerRow }) => {
    const rows = lastRow - firstRow + 1
    const columns = lastColumn - firstColumn + 1
    return (
      rows > 0 &&
      rows <= 200 &&
      columns > 0 &&
      columns <= 100 &&
      rows * columns <= 5000 &&
      (headerRow === undefined || headerRow <= firstRow)
    )
  })

export interface RagPayload extends RagAgentSelection {
  company_id: number
  org_id: number
  query: string
  limit: number
  stdb_token: string
  identity_hex: string
  include_types?: string[]
  ui_context?: unknown
  guide_refs?: RagGuideReference[]
  import_task_refs?: RagImportTaskReference[]
  spreadsheet_selection?: z.infer<typeof spreadsheetSelection>
  ui_action_offers: RagUiActionOffer[]
}

export type RagPrepareResult =
  | { ok: true; payload: RagPayload }
  | { ok: false; response: NextResponse }

/**
 * Common RAG body preparation: query validation, company-scope check,
 * limit clamping, include_types and ui_context sanitization, and payload
 * construction with session credentials.
 *
 * Explicit agent/persona intent is validated identically for JSON and SSE.
 */
export async function prepareRagPayload(params: {
  body: JsonObject
  session: ApiSession
  orgId: number
}): Promise<RagPrepareResult> {
  const { body, session, orgId } = params

  const query = typeof body.query === "string" ? body.query.trim() : ""
  if (!query) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "query is required" },
        { status: 400 },
      ),
    }
  }

  const companyId = positiveInteger(body.companyId ?? body.company_id)
  let guideRefs: RagGuideReference[] | undefined
  let importTaskRefs: RagImportTaskReference[] | undefined
  let agentSelection: RagAgentSelection
  try {
    guideRefs = parseRagGuideReferences(body.guide_refs)
    importTaskRefs = parseRagImportTaskReferences(
      body.import_task_refs,
      companyId,
    )
    agentSelection = parseRagAgentSelection(body)
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid guide references",
        },
        { status: 400 },
      ),
    }
  }

  const scopeError = await validateCompanyScope(session, companyId)
  if (scopeError) return { ok: false, response: scopeError }

  if (body.spreadsheet_selection !== undefined) {
    const selection = spreadsheetSelection.safeParse(body.spreadsheet_selection)
    if (
      !selection.success ||
      ![
        "Explain the selected spreadsheet cells.",
        "Check the selected spreadsheet cells for issues.",
      ].includes(query)
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid spreadsheet analysis request" },
          { status: 400 },
        ),
      }
    }
    return {
      ok: true,
      payload: {
        ...agentSelection,
        company_id: companyId,
        org_id: orgId,
        query,
        limit: 1,
        stdb_token: session.stdbToken,
        identity_hex: session.identityHex,
        spreadsheet_selection: selection.data,
        ui_action_offers: [],
      },
    }
  }

  const limit = boundedInteger(body.limit, 20, 1, 40)
  const include_types = sanitizeIncludeTypes(body.include_types)
  const ui_context = sanitizeRagUiContext(body.ui_context)
  const page = await serverRagPageCatalog({
    session,
    orgId,
    companyId,
    uiContext: ui_context,
  })

  const payload: RagPayload = {
    ...agentSelection,
    company_id: companyId,
    org_id: orgId,
    query,
    limit,
    stdb_token: session.stdbToken,
    identity_hex: session.identityHex,
    ui_action_offers: serverRagUiActionOffers(session, page),
  }
  if (include_types?.length) payload.include_types = include_types
  if (ui_context) payload.ui_context = ui_context
  if (guideRefs) payload.guide_refs = guideRefs
  if (importTaskRefs) payload.import_task_refs = importTaskRefs

  return { ok: true, payload }
}
