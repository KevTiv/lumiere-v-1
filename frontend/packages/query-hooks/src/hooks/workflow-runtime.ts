export type WorkflowRuntimeId = bigint | number | string

export interface WorkflowConditionSnapshotWire {
  subject_model: string
  subject_id: number
  subject_revision_hash: string
  fields: unknown[]
}

export interface StartWorkflowInput {
  companyId: WorkflowRuntimeId
  workflowId: WorkflowRuntimeId
  workflowVersionId: WorkflowRuntimeId
  subjectModel: string
  subjectId: WorkflowRuntimeId
  singletonTriggerKey?: string
  idempotencyKey: string
  correlationId: string
}

export interface SignalWorkflowInput {
  companyId: WorkflowRuntimeId
  instanceId: WorkflowRuntimeId
  workflowVersionId: WorkflowRuntimeId
  subjectModel: string
  subjectId: WorkflowRuntimeId
  expectedRevision: WorkflowRuntimeId
  signalKey: string
  idempotencyKey: string
  correlationId: string
}

export interface WorkflowSubjectSnapshotRequestInput {
  companyId: WorkflowRuntimeId
  workflowVersionId: WorkflowRuntimeId
  subjectModel: string
  subjectId: WorkflowRuntimeId
}

function read(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake]
}

function u64(value: WorkflowRuntimeId, label: string): number {
  const normalized = typeof value === "bigint" ? value : BigInt(String(value))
  if (normalized < 0n || normalized > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the safe workflow identifier range`)
  }
  return Number(normalized)
}

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim()
  if (!text) throw new Error(`${label} is required`)
  return text
}

export function buildWorkflowSubjectSnapshotRequest(
  input: WorkflowSubjectSnapshotRequestInput,
): {
  companyId: number
  params: { subjectModel: string; subjectId: number; workflowVersionId: number }
} {
  return {
    companyId: u64(input.companyId, "companyId"),
    params: {
      subjectModel: requiredText(input.subjectModel, "subjectModel"),
      subjectId: u64(input.subjectId, "subjectId"),
      workflowVersionId: u64(input.workflowVersionId, "workflowVersionId"),
    },
  }
}

export function selectWorkflowSubjectSnapshot(
  rows: readonly Record<string, unknown>[],
  input: {
    companyId: WorkflowRuntimeId
    subjectModel: string
    subjectId: WorkflowRuntimeId
    workflowVersionId: WorkflowRuntimeId
  },
): WorkflowConditionSnapshotWire {
  const companyId = u64(input.companyId, "companyId")
  const subjectId = u64(input.subjectId, "subjectId")
  const workflowVersionId = u64(input.workflowVersionId, "workflowVersionId")
  const subjectModel = requiredText(input.subjectModel, "subjectModel")

  const matches = rows.filter(
    (row) =>
      Number(read(row, "companyId", "company_id")) === companyId &&
      String(read(row, "subjectModel", "subject_model")) === subjectModel &&
      Number(read(row, "subjectId", "subject_id")) === subjectId &&
      Number(read(row, "workflowVersionId", "workflow_version_id")) === workflowVersionId,
  )

  if (matches.length === 0) {
    throw new Error("requested workflow subject snapshot was not returned")
  }
  if (matches.length !== 1) {
    throw new Error("requested workflow subject snapshot is ambiguous")
  }

  const row = matches[0]!
  const fields = row.fields
  if (!Array.isArray(fields)) {
    throw new Error("requested workflow subject snapshot has invalid fields")
  }

  return {
    subject_model: subjectModel,
    subject_id: subjectId,
    subject_revision_hash: requiredText(
      read(row, "subjectRevisionHash", "subject_revision_hash"),
      "subjectRevisionHash",
    ),
    fields,
  }
}

export function buildStartWorkflowWireParams(
  input: StartWorkflowInput,
  snapshot: WorkflowConditionSnapshotWire,
): Record<string, unknown> {
  const singletonTriggerKey = input.singletonTriggerKey?.trim()
  return {
    company_id: u64(input.companyId, "companyId"),
    workflow_id: u64(input.workflowId, "workflowId"),
    workflow_version_id: u64(input.workflowVersionId, "workflowVersionId"),
    subject_model: requiredText(input.subjectModel, "subjectModel"),
    subject_id: u64(input.subjectId, "subjectId"),
    subject_revision_hash: snapshot.subject_revision_hash,
    singleton_trigger_key: singletonTriggerKey ? { some: singletonTriggerKey } : { none: [] },
    idempotency_key: requiredText(input.idempotencyKey, "idempotencyKey"),
    correlation_id: requiredText(input.correlationId, "correlationId"),
    causation_id: { none: [] },
  }
}

export function buildSignalWorkflowWireParams(
  input: SignalWorkflowInput,
  snapshot: WorkflowConditionSnapshotWire,
): Record<string, unknown> {
  return {
    company_id: u64(input.companyId, "companyId"),
    instance_id: u64(input.instanceId, "instanceId"),
    expected_revision: u64(input.expectedRevision, "expectedRevision"),
    signal_key: requiredText(input.signalKey, "signalKey"),
    snapshot,
    idempotency_key: requiredText(input.idempotencyKey, "idempotencyKey"),
    correlation_id: requiredText(input.correlationId, "correlationId"),
    causation_id: { none: [] },
  }
}
