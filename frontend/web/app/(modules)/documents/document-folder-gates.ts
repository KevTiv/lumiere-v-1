type Row = Record<string, unknown>;

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
