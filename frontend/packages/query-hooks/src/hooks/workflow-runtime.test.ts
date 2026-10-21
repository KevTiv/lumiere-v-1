import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSignalWorkflowWireParams,
  buildStartWorkflowWireParams,
  buildWorkflowSubjectSnapshotRequest,
  selectWorkflowSubjectSnapshot,
} from "./workflow-runtime"

const fields = [{ field_key: "state", value: { code: "draft" } }]
const snapshot = {
  subject_model: "sale_order",
  subject_id: 41,
  subject_revision_hash: "sha256:subject-41",
  fields,
}

test("selects one exact subject snapshot without newest-row fallback", () => {
  const selected = selectWorkflowSubjectSnapshot(
    [
      {
        company_id: 7,
        subject_model: "sale_order",
        subject_id: 42,
        workflow_version_id: 13,
        subject_revision_hash: "wrong-subject",
        fields: [],
      },
      {
        company_id: 7,
        subject_model: "sale_order",
        subject_id: 41,
        workflow_version_id: 13,
        subject_revision_hash: "sha256:subject-41",
        fields,
      },
    ],
    {
      companyId: 7,
      subjectModel: "sale_order",
      subjectId: 41,
      workflowVersionId: 13,
    },
  )

  assert.deepEqual(selected, snapshot)
  assert.equal(selected.fields, fields)
})

test("rejects missing and ambiguous subject snapshots", () => {
  const identity = {
    companyId: 7,
    subjectModel: "sale_order",
    subjectId: 41,
    workflowVersionId: 13,
  }
  assert.throws(() => selectWorkflowSubjectSnapshot([], identity), /was not returned/)
  const row = {
    company_id: 7,
    subject_model: "sale_order",
    subject_id: 41,
    workflow_version_id: 13,
    subject_revision_hash: "sha256:subject-41",
    fields,
  }
  assert.throws(() => selectWorkflowSubjectSnapshot([row, { ...row }], identity), /ambiguous/)
})

test("normalizes subject snapshot request identifiers to JSON-safe numbers", () => {
  assert.deepEqual(
    buildWorkflowSubjectSnapshotRequest({
      companyId: "7",
      workflowVersionId: 13n,
      subjectModel: "sale_order",
      subjectId: "41",
    }),
    {
      companyId: 7,
      params: {
        subjectModel: "sale_order",
        subjectId: 41,
        workflowVersionId: 13,
      },
    },
  )
})

test("builds exact start wire JSON with explicit option variants", () => {
  const base = {
    companyId: 7,
    workflowId: 11,
    workflowVersionId: 13,
    subjectModel: "sale_order",
    subjectId: 41,
    idempotencyKey: "start-idempotency",
    correlationId: "start-correlation",
  }

  assert.deepEqual(buildStartWorkflowWireParams(base, snapshot), {
    company_id: 7,
    workflow_id: 11,
    workflow_version_id: 13,
    subject_model: "sale_order",
    subject_id: 41,
    subject_revision_hash: "sha256:subject-41",
    singleton_trigger_key: { none: [] },
    idempotency_key: "start-idempotency",
    correlation_id: "start-correlation",
    causation_id: { none: [] },
  })
  assert.deepEqual(
    buildStartWorkflowWireParams({ ...base, singletonTriggerKey: " order-41 " }, snapshot),
    {
      company_id: 7,
      workflow_id: 11,
      workflow_version_id: 13,
      subject_model: "sale_order",
      subject_id: 41,
      subject_revision_hash: "sha256:subject-41",
      singleton_trigger_key: { some: "order-41" },
      idempotency_key: "start-idempotency",
      correlation_id: "start-correlation",
      causation_id: { none: [] },
    },
  )
})

test("builds exact signal wire JSON and preserves the snapshot", () => {
  const wire = buildSignalWorkflowWireParams(
    {
      companyId: 7,
      instanceId: 99,
      workflowVersionId: 13,
      subjectModel: "sale_order",
      subjectId: 41,
      expectedRevision: 3,
      signalKey: "complete",
      idempotencyKey: "signal-idempotency",
      correlationId: "signal-correlation",
    },
    snapshot,
  )

  assert.deepEqual(wire, {
    company_id: 7,
    instance_id: 99,
    expected_revision: 3,
    signal_key: "complete",
    snapshot,
    idempotency_key: "signal-idempotency",
    correlation_id: "signal-correlation",
    causation_id: { none: [] },
  })
  assert.equal(wire.snapshot, snapshot)
})
