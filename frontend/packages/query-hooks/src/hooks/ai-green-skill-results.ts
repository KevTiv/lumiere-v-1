import type { LowStockItem, LowStockScanResult } from "@lumiere/erp-shared/ai-low-stock-schemas"
import type { PolicyDecision, PolicyResult, PrivacyReport } from "@lumiere/erp-shared/ai-policy-schemas"
import type { ReportComposerResult } from "@lumiere/erp-shared/ai-report-composer-schemas"

type GatewayPolicyDecision = Pick<PolicyDecision, "outcome" | "risk" | "reasons"> & {
  skill: { skill_key: string; version: number }
  correlation: {
    correlation_id: string
    organization_id: number
    company_id: number
    actor_id?: string
    causation_id?: string
  }
  hashes: { request_hash: string; input_hash: string; manifest_hash?: string }
  enforced_limits?: { max_rows: number; max_steps: number; max_tool_calls: number }
}

type GatewayPolicyResult = Pick<PolicyResult, "output"> & {
  decision: GatewayPolicyDecision
  privacy?: { rows_processed: number; masked_fields: string[]; suppressed_fields: string[] }
  action_draft?: PolicyResult["actionDraft"]
  output_hash?: string
  result_hash: string
}

type GatewayLowStockItem = Pick<LowStockItem, "sku" | "name"> & {
  organization_id: number
  company_id: number
  product_id: number
  quantity_on_hand: number
  reorder_level: number
}

type GatewayLowStockScanResult = Omit<LowStockScanResult, "decision" | "items"> & {
  decision: GatewayPolicyResult
  items: GatewayLowStockItem[]
}

type GatewayReportComposerResult = Omit<ReportComposerResult, "decision"> & {
  decision: GatewayPolicyResult
}

function normalizePrivacy(privacy: NonNullable<GatewayPolicyResult["privacy"]>): PrivacyReport {
  return {
    rowsProcessed: privacy.rows_processed,
    maskedFields: privacy.masked_fields,
    suppressedFields: privacy.suppressed_fields,
  }
}

function normalizePolicyResult(result: GatewayPolicyResult): PolicyResult {
  const { decision, privacy, output, action_draft, output_hash, result_hash } = result
  const { skill, correlation, hashes, enforced_limits } = decision
  return {
    decision: {
      outcome: decision.outcome,
      risk: decision.risk,
      reasons: decision.reasons,
      skill: { skillKey: skill.skill_key, version: skill.version },
      correlation: {
        correlationId: correlation.correlation_id,
        organizationId: correlation.organization_id,
        companyId: correlation.company_id,
        actorId: correlation.actor_id,
        causationId: correlation.causation_id,
      },
      hashes: {
        requestHash: hashes.request_hash,
        inputHash: hashes.input_hash,
        manifestHash: hashes.manifest_hash,
      },
      enforcedLimits: enforced_limits && {
        maxRows: enforced_limits.max_rows,
        maxSteps: enforced_limits.max_steps,
        maxToolCalls: enforced_limits.max_tool_calls,
      },
    },
    output,
    privacy: privacy && normalizePrivacy(privacy),
    actionDraft: action_draft,
    outputHash: output_hash,
    resultHash: result_hash,
  }
}

export function parseLowStockScanResult(result: GatewayLowStockScanResult): LowStockScanResult {
  return {
    ...result,
    decision: normalizePolicyResult(result.decision),
    items: result.items.map((item) => ({
      organizationId: item.organization_id,
      companyId: item.company_id,
      productId: item.product_id,
      sku: item.sku,
      name: item.name,
      quantityOnHand: item.quantity_on_hand,
      reorderLevel: item.reorder_level,
    })),
  }
}

export function parseReportComposerResult(result: GatewayReportComposerResult): ReportComposerResult {
  return { ...result, decision: normalizePolicyResult(result.decision) }
}
