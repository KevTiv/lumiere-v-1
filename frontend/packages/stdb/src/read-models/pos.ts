/** Loose row shape from `/api/query/pos-terminals` (and similar POS lists). */
export type PosTerminalQueryRow = Record<string, unknown>;

/** Primary label for POS terminal rows (name, location). */
export function posTerminalPrimaryLabel(row: PosTerminalQueryRow): string {
  return primaryLabel([row.name, row.locationLabel, row.terminalName], row.id);
}
import { primaryLabel } from "./primary-label";
