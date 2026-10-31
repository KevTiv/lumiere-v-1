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

/** Standalone lines use general-journal readiness only for known draft entries. */
export function journalLineImportReadinessAction(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  moves: readonly {
    id?: bigint | number | string;
    companyId?: bigint | number | string;
    moveType?: unknown;
    state?: unknown;
  }[],
  companyId: bigint | number | string,
): AccountingReadinessAction {
  const index = headers.indexOf("move_id");
  if (!rows.length || index < 0 || new Set(headers).size !== headers.length) return "import";
  const tag = (value: unknown) => typeof value === "string" ? value
    : value && typeof value === "object" && "tag" in value ? value.tag : undefined;
  return rows.every(row => {
    const id = (row[index] ?? "").trim();
    if (!/^[1-9]\d*$/.test(id)) return false;
    const parents = moves.filter(move => String(move.id) === id && String(move.companyId) === String(companyId));
    return parents.length === 1 && tag(parents[0].moveType) === "Entry" && tag(parents[0].state) === "Draft";
  }) ? "journal-import" : "import";
}
