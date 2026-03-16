import ProjectRow from "../generated/project_project_table";
import TaskRow from "../generated/project_task_table";
import TimesheetRow from "../generated/project_timesheet_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type ProjectProject = Infer<typeof ProjectRow>;
export type ProjectTask = Infer<typeof TaskRow>;
export type ProjectTimesheet = Infer<typeof TimesheetRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function projectsSubscriptions(companyId: bigint): string[] {
  const id = String(companyId);
  return [
    `SELECT * FROM project_project WHERE company_id = ${id}`,
    `SELECT * FROM project_task WHERE company_id = ${id}`,
    `SELECT * FROM project_timesheet WHERE company_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryProjects(): ProjectProject[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.project_project.iter()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
}

export function queryTasks(): ProjectTask[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.project_task.iter()].sort(
    (a, b) => Number(a.dateDeadline ?? 0) - Number(b.dateDeadline ?? 0),
  );
}

export function queryTimesheets(): ProjectTimesheet[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.project_timesheet.iter()].sort(
    (a, b) => Number(b.date ?? 0) - Number(a.date ?? 0),
  );
}
