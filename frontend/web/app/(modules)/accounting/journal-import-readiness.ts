import type { AccountingReadinessAction } from "@lumiere/ui";

/** Only a file containing general entries may omit invoice and tax setup. */
export function journalImportReadinessAction(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): AccountingReadinessAction {
  if (!rows.length || new Set(headers).size !== headers.length) return "import";
  const typeIndex = headers.indexOf("move_type");
  // The canonical backend import contract defaults a missing/blank type to Entry.
  if (typeIndex < 0) return "journal-import";
  return rows.every(row => ["", "entry"].includes((row[typeIndex] ?? "").trim().toLowerCase()))
    ? "journal-import" : "import";
}
