/** Auto-generated Create*Params mappers for workflows coverage gap. */

import type {
  CreateWorkflowDelegationParams,
  CreateWorkflowMigrationPlanParams,
  WorkflowDeliveryGuarantee,
  WorkflowEdgeMigrationMapping,
  WorkflowForkMigrationMapping,
  WorkflowNodeMigrationMapping,
} from "@lumiere/stdb/types"

import {
  field,
  optionalBigIntU64,
  optionalTrimmedString,
  u64IdArrayFromForm,
  num,
  stringArrayFromForm,
  optionalTimestampFromForm,
  requiredTimestampFromForm,
  optionalIdentityFromForm,
  requiredIdentityFromForm,
  identityArrayFromForm,
  unitEnumFromForm,
  unitEnumArrayFromForm,
  messageChannelArrayFromForm,
  objectArrayFromForm,
  stbTimestampFromDate,
} from "./create-params-helpers"

export function toCreateWorkflowDelegationParams(
  formData: Record<string, unknown>,
): CreateWorkflowDelegationParams | null {
  return {
    delegatorIdentity: requiredIdentityFromForm(field(formData, "delegatorIdentity", "delegator_identity"))!,
    delegateeIdentity: requiredIdentityFromForm(field(formData, "delegateeIdentity", "delegatee_identity"))!,
    roleId: optionalBigIntU64(field(formData, "roleId", "role_id")),
    validFrom: requiredTimestampFromForm(field(formData, "validFrom", "valid_from")) ?? stbTimestampFromDate(new Date()),
    validUntil: requiredTimestampFromForm(field(formData, "validUntil", "valid_until")) ?? stbTimestampFromDate(new Date()),
    reason: optionalTrimmedString(field(formData, "reason", "reason")),
  }
}

export function toCreateWorkflowMigrationPlanParams(
  formData: Record<string, unknown>,
): CreateWorkflowMigrationPlanParams | null {
  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const workflowId = optionalBigIntU64(field(formData, "workflowId", "workflow_id"))
  const sourceWorkflowVersionId = optionalBigIntU64(field(formData, "sourceWorkflowVersionId", "source_workflow_version_id"))
  const targetWorkflowVersionId = optionalBigIntU64(field(formData, "targetWorkflowVersionId", "target_workflow_version_id"))
  if (companyId === undefined || workflowId === undefined || sourceWorkflowVersionId === undefined || targetWorkflowVersionId === undefined) return null

  return {
    nodeMappings: objectArrayFromForm(field(formData, "nodeMappings", "node_mappings")).map((row) => ({ fromNodeKey: String(row.fromNodeKey ?? row.from_node_key ?? ""), toNodeKey: String(row.toNodeKey ?? row.to_node_key ?? "") })),
    forkMappings: objectArrayFromForm(field(formData, "forkMappings", "fork_mappings")).map((row) => ({ fromForkNodeKey: String(row.fromForkNodeKey ?? row.from_fork_node_key ?? ""), toForkNodeKey: String(row.toForkNodeKey ?? row.to_fork_node_key ?? ""), branchKeyMappings: objectArrayFromForm(row.branchKeyMappings ?? row.branch_key_mappings).map((b) => ({ fromBranchKey: String(b.fromBranchKey ?? b.from_branch_key ?? ""), toBranchKey: String(b.toBranchKey ?? b.to_branch_key ?? "") })) })),
    edgeMappings: objectArrayFromForm(field(formData, "edgeMappings", "edge_mappings")).map((row) => ({ fromEdgeKey: String(row.fromEdgeKey ?? row.from_edge_key ?? ""), toEdgeKey: String(row.toEdgeKey ?? row.to_edge_key ?? "") })),
    companyId,
    workflowId,
    sourceWorkflowVersionId,
    targetWorkflowVersionId,
    active: field(formData, "active", "active") !== false,
  }
}

export function toCreateWorkflowOutboxParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const actionKey = optionalTrimmedString(field(formData, "actionKey", "action_key"))
  const payload = optionalTrimmedString(field(formData, "payload", "payload"))
  const semanticKey = optionalTrimmedString(field(formData, "semanticKey", "semantic_key"))
  if (!actionKey || !payload || !semanticKey) return null

  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const instanceId = optionalBigIntU64(field(formData, "instanceId", "instance_id"))
  const tokenId = optionalBigIntU64(field(formData, "tokenId", "token_id"))
  const expectedTokenRevision = optionalBigIntU64(field(formData, "expectedTokenRevision", "expected_token_revision"))
  const edgeId = optionalBigIntU64(field(formData, "edgeId", "edge_id"))
  if (companyId === undefined || instanceId === undefined || tokenId === undefined || expectedTokenRevision === undefined || edgeId === undefined) return null

  return {
    companyId,
    instanceId,
    tokenId,
    expectedTokenRevision,
    edgeId,
    actionKey,
    payload,
    semanticKey,
    deliveryGuarantee: unitEnumFromForm<WorkflowDeliveryGuarantee>(field(formData, "deliveryGuarantee", "delivery_guarantee"), ["ExternallyIdempotent", "NonIdempotent"] as const, "ExternallyIdempotent"),
    queueName: optionalTrimmedString(field(formData, "queueName", "queue_name")) ?? "",
    jobType: optionalTrimmedString(field(formData, "jobType", "job_type")) ?? "",
    priority: Math.trunc(num(field(formData, "priority", "priority"), 0)),
    maxAttempts: Math.trunc(num(field(formData, "maxAttempts", "max_attempts"), 0)),
    availableAtMicros: optionalBigIntU64(field(formData, "availableAtMicros", "available_at_micros")),
    correlationId: optionalTrimmedString(field(formData, "correlationId", "correlation_id")) ?? "",
    causationId: optionalTrimmedString(field(formData, "causationId", "causation_id")),
  }
}

export function toCreateWorkflowTimerParams(
  formData: Record<string, unknown>,
): Record<string, unknown> | null {
  const semanticKey = optionalTrimmedString(field(formData, "semanticKey", "semantic_key"))
  const correlationId = optionalTrimmedString(field(formData, "correlationId", "correlation_id"))
  if (!semanticKey || !correlationId) return null

  const companyId = optionalBigIntU64(field(formData, "companyId", "company_id"))
  const instanceId = optionalBigIntU64(field(formData, "instanceId", "instance_id"))
  const tokenId = optionalBigIntU64(field(formData, "tokenId", "token_id"))
  const expectedTokenRevision = optionalBigIntU64(field(formData, "expectedTokenRevision", "expected_token_revision"))
  const edgeId = optionalBigIntU64(field(formData, "edgeId", "edge_id"))
  if (companyId === undefined || instanceId === undefined || tokenId === undefined || expectedTokenRevision === undefined || edgeId === undefined) return null

  return {
    companyId,
    instanceId,
    tokenId,
    expectedTokenRevision,
    edgeId,
    dueAt: requiredTimestampFromForm(field(formData, "dueAt", "due_at")) ?? stbTimestampFromDate(new Date()),
    semanticKey,
    correlationId,
    causationId: optionalTrimmedString(field(formData, "causationId", "causation_id")),
  }
}

