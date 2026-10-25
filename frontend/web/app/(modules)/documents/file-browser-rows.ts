import type { FileBrowserFile, FileBrowserFolder } from '@lumiere/ui';
import { formatTimestampLike } from '@lumiere/ui/lib/entity-row-values';
import { resolveIdentityLabel } from '@lumiere/ui/lib/identity-label';

/** The document fields the file browser reads; generated `Document` rows satisfy it. */
export interface BrowserDocumentRow {
  id: unknown;
  name: string;
  fileName: string;
  mimetype: string;
  fileSize: unknown;
  folderId?: unknown;
  isDeleted?: boolean;
  isShared?: boolean;
  isLocked?: boolean;
  isFavorite?: boolean;
  writeUid?: unknown;
  writeDate?: unknown;
}

/** The folder fields the file browser reads; generated `DocumentFolder` rows satisfy it. */
export interface BrowserFolderRow {
  id: unknown;
  name: string;
  parentId?: unknown;
  isHidden?: boolean;
  isFavorite?: boolean;
  sequence?: number;
  writeDate?: unknown;
}

const epochMs = (value: unknown): number | null => formatTimestampLike(value)?.getTime() ?? null;

export function toBrowserFiles(
  documents: readonly BrowserDocumentRow[],
  identityLabels: ReadonlyMap<string, string>,
): FileBrowserFile[] {
  return documents
    .filter((doc) => !doc.isDeleted)
    .map((doc) => ({
      id: String(doc.id),
      name: doc.name || doc.fileName,
      fileName: doc.fileName,
      mimetype: doc.mimetype,
      size: Number(doc.fileSize) || 0,
      folderId: doc.folderId == null ? null : String(doc.folderId),
      updatedAt: epochMs(doc.writeDate),
      modifiedBy: doc.writeUid == null ? '—' : resolveIdentityLabel(doc.writeUid, identityLabels),
      isShared: doc.isShared === true,
      isLocked: doc.isLocked === true,
      isFavorite: doc.isFavorite === true,
    }));
}

/** Visible folders with the count, size and latest change of the files in them. */
export function toBrowserFolders(
  folders: readonly BrowserFolderRow[],
  files: readonly FileBrowserFile[],
): FileBrowserFolder[] {
  const visibleFolders = folders.filter((folder) => !folder.isHidden);
  const visibleIds = new Set(visibleFolders.map((folder) => String(folder.id)));
  return visibleFolders
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.name.localeCompare(b.name))
    .map((folder) => {
      const id = String(folder.id);
      const parentId = folder.parentId == null ? null : String(folder.parentId);
      const own = files.filter((file) => file.folderId === id);
      const latest = Math.max(epochMs(folder.writeDate) ?? 0, ...own.map((file) => file.updatedAt ?? 0));
      return {
        id,
        name: folder.name,
        // Never project an ancestor that this actor's folder collection does not expose.
        parentId: parentId !== id && parentId !== null && visibleIds.has(parentId) ? parentId : null,
        fileCount: own.length,
        totalSize: own.reduce((sum, file) => sum + file.size, 0),
        updatedAt: latest > 0 ? latest : null,
        isFavorite: folder.isFavorite === true,
      };
    });
}

/** Document name for an uploaded file: its file name without the extension. */
export function documentNameFromFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base.trim() || fileName;
}
