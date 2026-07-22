/** Loose row shape from `/api/query/projects` (and similar project lists). */
export type ProjectsQueryRow = Record<string, unknown>;

/** Primary label for project rows. */
export function projectPrimaryLabel(row: ProjectsQueryRow): string {
  return primaryLabel([row.name, row.displayName, row.code], row.id);
}
import { primaryLabel } from "./primary-label";
