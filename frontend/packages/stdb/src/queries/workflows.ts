import WorkflowRow from "../generated/workflow_table";
import WorkflowInstanceRow from "../generated/workflow_instance_table";
import WorkflowActivityRow from "../generated/workflow_activity_table";
import WorkflowTransitionRow from "../generated/workflow_transition_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type Workflow = Infer<typeof WorkflowRow>;
export type WorkflowInstance = Infer<typeof WorkflowInstanceRow>;
export type WorkflowActivity = Infer<typeof WorkflowActivityRow>;
export type WorkflowTransition = Infer<typeof WorkflowTransitionRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function workflowsSubscriptions(organizationId: bigint): string[] {
  const id = String(organizationId);
  return [
    `SELECT * FROM workflow WHERE organization_id = ${id}`,
    `SELECT * FROM workflow_instance WHERE organization_id = ${id}`,
    `SELECT * FROM workflow_activity WHERE organization_id = ${id}`,
    `SELECT * FROM workflow_transition WHERE organization_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryWorkflows(): Workflow[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.workflow.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function queryWorkflowInstances(): WorkflowInstance[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.workflow_instance.iter()].sort(
    (a, b) => Number(b.createDate ?? 0) - Number(a.createDate ?? 0),
  );
}

export function queryWorkflowActivities(): WorkflowActivity[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.workflow_activity.iter()].sort((a, b) =>
    (a.sequence ?? 0) - (b.sequence ?? 0),
  );
}

export function queryWorkflowTransitions(): WorkflowTransition[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.workflow_transition.iter()];
}
