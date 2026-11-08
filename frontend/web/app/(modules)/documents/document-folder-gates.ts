type Row = Record<string, unknown>;

interface FolderDestinationRow {
  id: unknown;
  name: string;
  parentId?: unknown;
}

/** Use visible parent links and exclude self/descendants without trusting cached paths. */
export function documentFolderDestinations(
  folders: readonly FolderDestinationRow[],
  movingFolderId?: string,
): Array<{ value: string; label: string }> {
  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  return folders.filter((folder) => {
    let current: string | null = String(folder.id);
    const visited = new Set<string>();
    while (current !== null) {
      if (current === movingFolderId || visited.has(current)) return false;
      visited.add(current);
      const ancestor = byId.get(current);
      // An inaccessible ancestor is not a destination whose scope we can preview.
      if (!ancestor) return false;
      current = ancestor.parentId == null ? null : String(ancestor.parentId);
    }
    return true;
  }).map((folder) => ({ value: String(folder.id), label: folder.name }));
}

/**
 * `delete_document_folder` refuses a folder that still holds documents or child folders. An unknown
 * document count is not treated as non-empty, so the server still has the last word.
 */
export function documentFolderCanBeDeleted(folder: Row, folders: readonly Row[]): boolean {
  const count = Number(folder.documentCount ?? folder.document_count ?? 0);
  if (Number.isFinite(count) && count > 0) return false;
  return !folders.some((candidate) => {
    const parent = candidate.parentId ?? candidate.parent_id;
    return parent != null && String(parent) === String(folder.id);
  });
}
