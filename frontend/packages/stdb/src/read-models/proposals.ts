/** Loose row shape from `/api/query/proposals` (and similar proposal lists). */
export type ProposalQueryRow = Record<string, unknown>;

/** Primary label for proposal rows (title, then client). */
export function proposalPrimaryLabel(row: ProposalQueryRow): string {
  return primaryLabel([row.title, row.clientName, row.name], row.id);
}
import { primaryLabel } from "./primary-label";
