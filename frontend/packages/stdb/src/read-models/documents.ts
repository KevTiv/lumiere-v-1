/** Loose row shape from `/api/query/documents` (and similar document lists). */
export type DocumentQueryRow = Record<string, unknown>;

/** Primary label for document rows (name, title, file name). */
export function documentPrimaryLabel(row: DocumentQueryRow): string {
  return primaryLabel([row.name, row.title, row.fileName, row.displayName], row.id);
}
import { primaryLabel } from "./primary-label";
