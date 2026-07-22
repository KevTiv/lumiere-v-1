/**
 * Maps Workflows module form payloads to SpacetimeDB CreateWorkflowParams.
 */

import type { CreateWorkflowParams, WorkflowTrigger } from "@lumiere/stdb/types"
import { formValue as field } from "./form-coercion"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function parseTrigger(raw: unknown): WorkflowTrigger {
  const s = String(raw ?? "Manual").trim()
  const allowed = ["Manual", "RecordCreated", "RecordChanged", "Signal"] as const
  const tag = (allowed as readonly string[]).includes(s) ? s : "Manual"
  return { tag: tag as WorkflowTrigger["tag"] } as WorkflowTrigger
}

export function toCreateWorkflowParams(
  formData: Record<string, unknown>,
): CreateWorkflowParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  const model = String(field(formData, "model", "model") ?? "").trim()
  const workflowKey = String(
    field(formData, "workflowKey", "workflow_key") ??
      field(formData, "key", "key") ??
      "",
  )
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
  if (!name || !model || !workflowKey) return null

  const schemaVersion = Math.max(
    1,
    Math.trunc(Number(field(formData, "schemaVersion", "schema_version") ?? 1)),
  )

  return {
    workflowKey,
    model,
    name,
    description: optionalTrimmedString(field(formData, "description", "description")),
    trigger: parseTrigger(field(formData, "trigger", "trigger")),
    schemaVersion,
    snapshotFields: [],
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
