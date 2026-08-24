/**
 * JSON-safe serialization for SpacetimeDB HTTP reducer bodies.
 *
 * SpacetimeDB HTTP expects snake_case keys, SATS sum JSON for Option/enum fields,
 * and timestamps as `{ __timestamp_micros_since_unix_epoch__: ... }`.
 */

import optionFieldsJson from "./stdb-http-option-fields.json" with { type: "json" }

type OptionFieldMap = Record<string, readonly string[]>
const OPTION_FIELDS = optionFieldsJson as OptionFieldMap

/** Vec-of-struct fields that need per-item Option encoding via `stdbParamsToJson`. */
const NESTED_ARRAY_STRUCTS: Partial<
  Record<string, Partial<Record<string, keyof OptionFieldMap & string>>>
> = {
  PublishFormConfigurationParams: {
    fields: "CreateFormFieldParams",
    role_configs: "CreateRoleConfigParams",
  },
  CreateFormFieldParams: {
    options: "FieldOption",
  },
  CreateReturnOrderParams: {
    lines: "CreateReturnOrderLineParams",
  },
  CreatePurchaseRfqParams: {
    lines: "CreatePurchaseRfqLineParams",
  },
  CreatePurchaseReturnParams: {
    lines: "CreatePurchaseReturnLineParams",
  },
  CreateSaleOrderParams: {
    order_lines: "CreateSaleOrderLineParams",
  },
}

/** Nested object fields that need struct-scoped Option encoding via `stdbParamsToJson`. */
const NESTED_OBJECT_STRUCTS: Partial<
  Record<string, Partial<Record<string, keyof OptionFieldMap & string>>>
> = {
  CreateFormFieldParams: {
    validation: "FieldValidation",
  },
  CreateCreditNoteFromReturnOrderParams: {
    receivable_line: "AddAccountMoveLineParams",
    income_line: "AddAccountMoveLineParams",
  },
  CreateInvoiceFromSaleOrderParams: {
    receivable_line: "AddAccountMoveLineParams",
    income_line: "AddAccountMoveLineParams",
  },
}

const STDB_TIMESTAMP_KEY = "__timestamp_micros_since_unix_epoch__"

/** SpacetimeDB HTTP reducer params use Rust snake_case field names, not TS camelCase. */
export function camelToSnakeIdentifier(s: string): string {
  const relation = s.match(/^(.*)(M2O|M2M|O2M)$/)
  if (relation) {
    const base = relation[1]
      .replace(/([a-z])(\d)/g, "$1_$2")
      .replace(/(\d)([A-Z])/g, "$1_$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
    return `${base}_${relation[2].toLowerCase()}`
  }

  return s
    .replace(/([a-z])(\d)/g, "$1_$2")
    .replace(/(\d)([A-Z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

/** SATS unit-variant sum JSON for SpacetimeDB HTTP (e.g. `{ "percent": [] }`). */
export function encodeTaggedUnitEnum(v: { tag: string }): Record<string, unknown> {
  const key = v.tag.charAt(0).toLowerCase() + v.tag.slice(1)
  return { [key]: [] }
}

function isTaggedPayloadEnum(v: unknown): v is { tag: string; value: unknown } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    "tag" in v &&
    "value" in v &&
    typeof (v as { tag?: unknown }).tag === "string"
  )
}

/** SATS tuple-variant sum JSON (e.g. `{ tag: "Role", value: 1n }` → `{ role: 1 }`). */
export function encodeTaggedPayloadEnum(v: {
  tag: string
  value: unknown
}): Record<string, unknown> {
  const key = v.tag.charAt(0).toLowerCase() + v.tag.slice(1)
  let encodedValue = v.value
  if (key === "user") {
    encodedValue = encodeIdentity(v.value)
  } else if (typeof v.value === "bigint") {
    encodedValue = bigintToJson(v.value)
  } else if (typeof v.value === "string" && /^\d+$/.test(v.value.trim())) {
    encodedValue = Number(v.value.trim())
  }
  return { [key]: encodedValue }
}

/** Match `@lumiere/api-client` `stringifyReducerCallBody`: STDB HTTP expects JSON numbers for `u64`. */
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

function isTimestampLike(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return STDB_TIMESTAMP_KEY in o || "microsSinceUnixEpoch" in o
}

function encodeTimestamp(v: unknown): Record<string, string | number> {
  const o = v as Record<string, unknown>
  const raw = o[STDB_TIMESTAMP_KEY] ?? o.microsSinceUnixEpoch
  if (typeof raw === "bigint") {
    if (raw > MAX_SAFE_BIGINT) {
      return { [STDB_TIMESTAMP_KEY]: raw.toString() }
    }
    return { [STDB_TIMESTAMP_KEY]: Number(raw) }
  }
  if (typeof raw === "number") {
    return { [STDB_TIMESTAMP_KEY]: raw }
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (trimmed !== "" && /^\d+$/.test(trimmed)) {
      const n = Number(trimmed)
      if (Number.isSafeInteger(n)) {
        return { [STDB_TIMESTAMP_KEY]: n }
      }
    }
    return { [STDB_TIMESTAMP_KEY]: raw }
  }
  throw new Error("stdbParamsToJson: invalid timestamp value")
}

function isTaggedEnum(v: unknown): v is { tag: string } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v as object).length === 1 &&
    typeof (v as { tag?: unknown }).tag === "string"
  )
}

function isSatsOption(v: unknown): boolean {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const keys = Object.keys(v as object)
  return keys.length === 1 && (keys[0] === "some" || keys[0] === "none")
}

/** Already-encoded SATS sum JSON (`{ outOfPocket: [] }`, `{ role: [1] }`) — do not snake_case the variant key. */
function isSatsSumJson(v: unknown): v is Record<string, unknown[]> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false
  const keys = Object.keys(v as object)
  if (keys.length !== 1) return false
  const key = keys[0]!
  if (key === "some" || key === "none") return false
  return Array.isArray((v as Record<string, unknown>)[key])
}

function bigintToJson(v: bigint): number {
  if (v < 0n) {
    throw new Error("stdbParamsToJson: negative bigint is not valid as u64 in JSON")
  }
  if (v > MAX_SAFE_BIGINT) {
    throw new Error(
      `stdbParamsToJson: bigint ${v} exceeds Number.MAX_SAFE_INTEGER; use a different encoding for this field`,
    )
  }
  return Number(v)
}

function encodeValue(
  value: unknown,
  optionFields: ReadonlySet<string> | undefined,
  fieldKey?: string,
): unknown {
  if (value === undefined) return undefined

  if (isTimestampLike(value)) {
    return encodeTimestamp(value)
  }

  if (isTaggedPayloadEnum(value)) {
    const encoded = encodeTaggedPayloadEnum(value)
    if (fieldKey && optionFields?.has(fieldKey)) {
      return { some: encoded }
    }
    return encoded
  }

  if (isTaggedEnum(value)) {
    const encoded = encodeTaggedUnitEnum(value)
    if (fieldKey && optionFields?.has(fieldKey)) {
      return { some: encoded }
    }
    return encoded
  }

  if (isSatsOption(value)) {
    const obj = value as Record<string, unknown>
    if ("none" in obj) return { none: [] }
    return { some: encodeValue(obj.some, optionFields) }
  }

  if (value === null) {
    if (fieldKey && optionFields?.has(fieldKey)) {
      return { none: [] }
    }
    return null
  }

  if (typeof value === "bigint") {
    if (fieldKey && optionFields?.has(fieldKey)) {
      if (value <= 0n) return { none: [] }
      return { some: bigintToJson(value) }
    }
    return bigintToJson(value)
  }

  if (typeof value === "number" && fieldKey && optionFields?.has(fieldKey)) {
    if (value <= 0) return { none: [] }
    return { some: value }
  }

  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item, optionFields))
  }

  if (isSatsSumJson(value)) {
    const key = Object.keys(value)[0]!
    return { [key]: encodeValue(value[key], optionFields) }
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const snakeKey = camelToSnakeIdentifier(key)
      const encoded = encodeValue(nested, optionFields, snakeKey)
      if (encoded !== undefined) {
        out[snakeKey] = encoded
      }
    }
    return out
  }

  if (fieldKey && optionFields?.has(fieldKey)) {
    return { some: value }
  }

  return value
}

/** SATS `Option<u64>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalU64(
  value: bigint | number | null | undefined,
): { none: [] } | { some: number } {
  if (value === null || value === undefined) return { none: [] }
  const n = typeof value === "bigint" ? bigintToJson(value) : value
  if (n === 0) return { none: [] }
  return { some: n }
}

/** SATS `Option<String>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalString(
  value: string | null | undefined,
): { none: [] } | { some: string } {
  if (value == null) return { none: [] }
  const s = String(value).trim()
  if (s === "") return { none: [] }
  return { some: s }
}

/** SATS `Option<bool>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalBool(
  value: boolean | null | undefined,
): { none: [] } | { some: boolean } {
  if (value === null || value === undefined) return { none: [] }
  return { some: value }
}

/** SpacetimeDB HTTP Identity (U256) JSON for flat reducer args. */
export function encodeIdentity(value: unknown): Record<string, string> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if ("__identity__" in obj && typeof obj.__identity__ === "string") {
      const raw = obj.__identity__
      const hex = raw.startsWith("0x") ? raw : `0x${raw}`
      return { __identity__: hex.toLowerCase() }
    }
  }
  const hex = String(value ?? "").replace(/^0x/i, "")
  if (hex.length !== 64) {
    throw new Error(
      `encodeIdentity: expected 64-char hex identity, got length ${hex.length}`,
    )
  }
  return { __identity__: `0x${hex.toLowerCase()}` }
}

/** SpacetimeDB HTTP Timestamp JSON for flat reducer args. */
export function encodeTimestampMicros(value: unknown): Record<string, string | number> {
  if (isTimestampLike(value)) {
    return encodeTimestamp(value)
  }
  if (typeof value === "bigint") {
    return encodeTimestamp({ microsSinceUnixEpoch: value })
  }
  if (typeof value === "number" || typeof value === "string") {
    return encodeTimestamp({ microsSinceUnixEpoch: value })
  }
  throw new Error("encodeTimestampMicros: invalid timestamp value")
}

/** SATS `Option<Timestamp>` JSON for flat reducer args (not struct fields). */
export function encodeOptionalTimestamp(
  value: Date | string | null | undefined,
): { none: [] } | { some: Record<string, string | number> } {
  if (value == null || value === "") return { none: [] }
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return { none: [] }
  const micros = BigInt(d.getTime()) * 1000n
  return { some: encodeTimestamp({ microsSinceUnixEpoch: micros }) }
}

/**
 * Encode generated TS reducer param structs for `POST /api/call/:reducer`.
 *
 * @param structName - Generated params type name (e.g. `CreateLeadParams`) so
 *   `Option<T>` fields are wrapped as `{ some: v }` / `{ none: [] }`.
 */
export function stdbParamsToJson(
  params: object,
  structName?: keyof OptionFieldMap & string,
): Record<string, unknown> {
  const optionFieldList = structName ? (OPTION_FIELDS[structName] ?? []) : []
  const optionFields = structName ? new Set(optionFieldList) : undefined
  const encoded = encodeValue(params, optionFields)
  const out = { ...((encoded ?? {}) as Record<string, unknown>) }

  const nestedArrays = structName ? NESTED_ARRAY_STRUCTS[structName] : undefined
  if (nestedArrays) {
    for (const [fieldSnake, itemStruct] of Object.entries(nestedArrays)) {
      const arr = out[fieldSnake]
      if (!Array.isArray(arr)) continue
      out[fieldSnake] = arr.map((item) =>
        item !== null && typeof item === "object"
          ? stdbParamsToJson(item as object, itemStruct)
          : item,
      )
    }
  }

  const nestedObjects = structName ? NESTED_OBJECT_STRUCTS[structName] : undefined
  if (nestedObjects) {
    for (const [fieldSnake, itemStruct] of Object.entries(nestedObjects)) {
      const nested = out[fieldSnake]
      if (nested === null || typeof nested !== "object" || Array.isArray(nested)) continue
      out[fieldSnake] = stdbParamsToJson(nested as object, itemStruct)
    }
  }

  // SpacetimeDB HTTP requires every Option field in the struct JSON body.
  if (structName) {
    for (const fieldSnake of optionFieldList) {
      if (!(fieldSnake in out)) {
        out[fieldSnake] = { none: [] }
      }
    }
  }

  return out
}

/** Last-arg struct names for `POST /api/call/:reducer` bodies in Playwright / scripts. */
const REDUCER_PARAM_STRUCTS: Partial<Record<string, keyof OptionFieldMap & string>> = {
  create_ai_insight: "CreateAiInsightParams",
  create_dashboard_widget: "CreateDashboardWidgetParams",
  create_lead: "CreateLeadParams",
  create_contact: "CreateContactParams",
  merge_contacts: "MergeContactsParams",
  convert_lead_to_customer: "ConvertLeadParams",
  convert_opportunity_to_sale_order: "ConvertOpportunityParams",
  create_opportunity_line: "CreateOpportunityLineParams",
  create_sale_order: "CreateSaleOrderParams",
  create_sale_order_line: "CreateSaleOrderLineParams",
  create_return_order: "CreateReturnOrderParams",
  create_invoice_from_sale_order: "CreateInvoiceFromSaleOrderParams",
  create_credit_note_from_return_order: "CreateCreditNoteFromReturnOrderParams",
  create_credit_note_from_invoice: "CreateCreditNoteParams",
  create_bill_from_purchase_order: "CreateBillFromPurchaseOrderParams",
  create_purchase_rfq: "CreatePurchaseRfqParams",
  add_purchase_rfq_bid: "CreatePurchaseRfqBidParams",
  add_purchase_rfq_line: "AddPurchaseRfqLineParams",
  create_purchase_return: "CreatePurchaseReturnParams",
  create_vendor_credit_from_purchase_return:
    "CreateVendorCreditFromPurchaseReturnParams",
  create_pricelist_item: "CreatePricelistItemParams",
  create_picking_batch: "CreatePickingBatchParams",
  create_purchase_requisition: "CreatePurchaseRequisitionParams",
  add_purchase_order_line: "AddPurchaseOrderLineParams",
  update_purchase_order: "UpdatePurchaseOrderParams",
  update_purchase_order_line: "UpdatePurchaseOrderLineParams",
  create_landed_cost: "CreateLandedCostParams",
  update_landed_cost: "UpdateLandedCostParams",
  add_landed_cost_line: "AddLandedCostLineParams",
  create_stock_picking: "CreateStockPickingParams",
  create_stock_move: "CreateStockMoveParams",
  confirm_stock_picking: "CompanyScopeParams",
  assign_stock_picking: "CompanyScopeParams",
  validate_stock_picking: "CompanyScopeParams",
  create_inventory_adjustment: "CreateInventoryAdjustmentParams",
  create_crossovered_budget: "CreateCrossoveredBudgetParams",
  create_crossovered_budget_line: "CreateCrossoveredBudgetLineParams",
  create_account_journal: "CreateAccountJournalParams",
  create_account_move: "CreateAccountMoveParams",
  create_account_bank_statement: "CreateAccountBankStatementParams",
  create_stock_inventory: "CreateStockInventoryParams",
  create_stock_inventory_line: "CreateStockInventoryLineParams",
  create_uom: "CreateUomParams",
  create_uom_category: "CreateUomCategoryParams",
  create_uom_conversion: "CreateUomConversionParams",
  create_product_variant: "CreateProductVariantParams",
  create_product_supplier_info: "CreateProductSupplierInfoParams",
  create_product_packaging: "CreateProductPackagingParams",
  create_barcode_nomenclature: "CreateBarcodeNomenclatureParams",
  create_replenishment_rule: "CreateReplenishmentRuleParams",
  create_leave_type: "CreateLeaveTypeParams",
  create_payroll_structure: "CreatePayrollStructureParams",
  create_salary_rule: "CreateSalaryRuleParams",
  create_employee: "CreateEmployeeParams",
  create_task: "CreateTaskParams",
  create_document_folder: "CreateDocumentFolderParams",
  create_document: "CreateDocumentParams",
  add_document_version: "AddDocumentVersionParams",
  update_document_folder: "UpdateDocumentFolderParams",
  update_document: "UpdateDocumentParams",
  set_document_index_content: "SetDocumentIndexContentParams",
  set_document_retention: "SetDocumentRetentionParams",
  schedule_document_retention_purge: "ScheduleDocumentRetentionPurgeParams",
  apply_document_legal_hold: "ApplyDocumentLegalHoldParams",
  release_document_legal_hold: "ReleaseDocumentLegalHoldParams",
  create_document_signature_request: "CreateDocumentSignatureRequestParams",
  complete_document_signature_request: "CompleteDocumentSignatureRequestParams",
  sync_external_file_to_document: "SyncExternalFileToDocumentParams",
  set_google_drive_conflict_policy: "SetDriveConflictPolicyParams",
  create_document_template: "CreateDocumentTemplateParams",
  update_document_template: "UpdateDocumentTemplateParams",
  create_mail_template: "CreateMailTemplateParams",
  update_mail_template: "UpdateMailTemplateParams",
  create_knowledge_category: "CreateKnowledgeCategoryParams",
  create_document_processing_job: "CreateDocumentProcessingJobParams",
  create_audit_rule: "CreateAuditRuleParams",
  claim_workflow_human_task: "ClaimWorkflowHumanTaskParams",
  decide_workflow_human_task: "DecideWorkflowHumanTaskParams",
  add_workflow_human_task_comment: "AddWorkflowHumanTaskCommentParams",
  invalidate_workflow_human_task: "InvalidateWorkflowHumanTaskParams",
  create_workflow: "CreateWorkflowParams",
  start_workflow: "StartWorkflowParams",
  signal_workflow: "SignalWorkflowParams",
  cancel_workflow: "CancelWorkflowParams",
  simulate_workflow: "SimulateWorkflowParams",
  upsert_workflow_node: "UpsertWorkflowNodeParams",
  upsert_workflow_edge: "UpsertWorkflowEdgeParams",
  create_workflow_migration_plan: "CreateWorkflowMigrationPlanParams",
  preflight_workflow_migration: "PreflightWorkflowMigrationParams",
  migrate_workflow_instance: "MigrateWorkflowInstanceParams",
  fire_workflow_timer: "FireWorkflowTimerParams",
  cancel_workflow_timer: "CancelWorkflowTimerParams",
  cancel_workflow_outbox: "CancelWorkflowOutboxParams",
  record_workflow_outbox_result: "RecordWorkflowOutboxResultParams",
  create_workflow_delegation: "CreateWorkflowDelegationParams",
  create_saved_report: "CreateSavedReportParams",
  create_utm_campaign: "CreateUtmCampaignParams",
  create_utm_medium: "CreateUtmMediumParams",
  create_utm_source: "CreateUtmSourceParams",
  create_form_configuration: "CreateFormConfigParams",
  publish_form_configuration: "PublishFormConfigurationParams",
  add_form_field: "CreateFormFieldParams",
  set_record_custom_field_values: "SetRecordCustomFieldValuesParams",
  grant_permission: "GrantOrgPermissionParams",
  grant_field_permission: "GrantFieldPermissionParams",
  add_org_member: "AddOrgMemberParams",
  assign_role: "AssignRoleParams",
  create_data_classification: "CreateDataClassificationParams",
  create_data_classification_rule: "CreateDataClassificationRuleParams",
  create_user_session: "CreateUserSessionParams",
  create_role: "CreateRoleParams",
  create_country: "CreateCountryParams",
  create_currency: "CreateCurrencyParams",
  create_fiscal_year: "CreateFiscalYearParams",
  create_account_period: "CreateAccountPeriodParams",
  create_analytic_account: "CreateAnalyticAccountParams",
  create_analytic_line: "CreateAnalyticLineParams",
  create_analytic_distribution_model: "CreateAnalyticDistributionModelParams",
  create_payment_term: "CreatePaymentTermParams",
  create_payment: "CreatePaymentParams",
  update_sale_order: "UpdateSaleOrderParams",
  create_ai_action_draft: "CreateAiActionDraftParams",
  update_ai_action_draft_params: "UpdateAiActionDraftParamsParams",
  post_account_move: undefined,
  create_expense: "CreateExpenseParams",
  create_fleet_vehicle: "CreateFleetVehicleParams",
  update_vehicle_position: "UpdateVehiclePositionParams",
  create_expense_sheet: "CreateExpenseSheetParams",
  create_expense_receipt: "CreateExpenseReceiptParams",
  update_expense: "UpdateExpenseParams",
  post_expense_sheet: "PostExpenseSheetParams",
  create_expense_reimbursement_payment: "CreateExpenseReimbursementParams",
  refuse_expense_sheet: "RefuseExpenseSheetParams",
  create_expense_project_rebill: "CreateExpenseProjectRebillParams",
  create_expense_integration_intent: "CreateExpenseIntegrationIntentParams",
  create_expense_advance: "CreateExpenseAdvanceParams",
  apply_expense_advance_to_sheet: "ApplyExpenseAdvanceParams",
  create_expense_card_statement_line: "CreateExpenseCardStatementLineParams",
  match_expense_card_statement_line: "MatchExpenseCardStatementLineParams",
  unmatch_expense_card_statement_line: "UnmatchExpenseCardStatementLineParams",
  set_expense_fraud_hold: "SetExpenseFraudHoldParams",
  request_expense_policy_exception: "RequestExpensePolicyExceptionParams",
  reject_expense_policy_exception: "RejectExpensePolicyExceptionParams",
  upsert_expense_mileage_rate: "UpsertExpenseMileageRateParams",
  upsert_expense_per_diem_rate: "UpsertExpensePerDiemRateParams",
  upsert_expense_policy: "UpsertExpensePolicyParams",
  fail_expense_integration_intent: "FailExpenseIntegrationIntentParams",
  create_proposal: "CreateProposalParams",
  update_proposal: "UpdateProposalParams",
  upsert_proposal_section: "UpsertProposalSectionParams",
  resolve_proposal_section_conflict: "UpsertProposalSectionParams",
  add_proposal_line_item: "AddProposalLineItemParams",
  update_proposal_line_item: "UpdateProposalLineItemParams",
  record_proposal_bid_decision: "RecordProposalBidDecisionParams",
  convert_proposal_to_sale_order: "ConvertProposalToSaleOrderParams",
  convert_proposal_to_project: "ConvertProposalToProjectParams",
  update_proposal_source_doc: "UpdateProposalSourceDocParams",
  create_proposal_template: "CreateProposalTemplateParams",
  create_proposal_clause: "CreateProposalClauseParams",
  upsert_proposal_compliance_requirement: "UpsertProposalComplianceRequirementParams",
  apply_proposal_analysis: "ApplyProposalAnalysisParams",
  upsert_proposal_procurement_score: "UpsertProposalProcurementScoreParams",
  create_proposal_integration_intent: "CreateProposalIntegrationIntentParams",
  complete_proposal_integration_intent: "CompleteProposalIntegrationIntentParams",
  fail_proposal_integration_intent: "FailProposalIntegrationIntentParams",
  create_proposal_clarification: "CreateProposalClarificationParams",
  answer_proposal_clarification: "AnswerProposalClarificationParams",
  link_proposal_version_esign: "LinkProposalVersionEsignParams",
}

/** Flat `Option<T>` arg indices for reducers without a trailing params struct. */
const FLAT_OPTION_ARG_INDICES: Partial<Record<string, readonly number[]>> = {
  update_payment_term: [2, 3, 4],
}

/** Flat non-option arg encoders (Identity, Timestamp, etc.). */
const FLAT_ARG_ENCODERS: Partial<
  Record<string, Partial<Record<number, (value: unknown) => unknown>>>
> = {
  create_user_invite: {
    4: encodeIdentity,
    5: encodeTimestampMicros,
  },
  add_org_member: {
    0: encodeIdentity,
  },
  assign_role: {
    0: encodeIdentity,
  },
}

function encodeFlatOptionalArg(value: unknown, argIndex: number, reducer: string): unknown {
  if (reducer === "update_payment_term") {
    switch (argIndex) {
      case 2:
      case 3:
        return encodeOptionalString(value as string | null | undefined)
      case 4:
        return encodeOptionalBool(value as boolean | null | undefined)
      default:
        return value
    }
  }
  return value
}

/**
 * Encode the trailing params object in a reducer arg list for SpacetimeDB HTTP.
 * Top-level org / id args are left unchanged.
 */
export function encodeReducerCallArgs(reducer: string, args: unknown[]): unknown[] {
  const flatEncoders = FLAT_ARG_ENCODERS[reducer]
  const flatOptionIndices = FLAT_OPTION_ARG_INDICES[reducer]
  let encoded = args
  if (flatEncoders || flatOptionIndices?.length) {
    encoded = args.map((arg, index) => {
      const encode = flatEncoders?.[index]
      if (encode) return encode(arg)
      if (flatOptionIndices?.includes(index)) {
        return encodeFlatOptionalArg(arg, index, reducer)
      }
      return arg
    })
  }

  const structName = REDUCER_PARAM_STRUCTS[reducer]
  if (!structName || encoded.length === 0) return encoded
  const lastIdx = encoded.length - 1
  const last = encoded[lastIdx]
  if (last === null || typeof last !== "object" || Array.isArray(last)) return encoded
  const withStruct = [...encoded]
  withStruct[lastIdx] = stdbParamsToJson(last as object, structName)
  return withStruct
}
