import { recordPageHref } from '@/lib/record-page-href';

type Row = Record<string, unknown>;

/** Where a document's page lives. */
export function documentRecordHref(document: Row): string | undefined {
  return document.id == null ? undefined : `/documents/${String(document.id)}`;
}

/** The page of the record a document is attached to, when that record has one. */
export function linkedRecordHref(document: Row): string | undefined {
  return recordPageHref(document.resModel ?? document.res_model, document.resId ?? document.res_id);
}

/** Plain-language size: 1536 → "1.5 KB". */
export function formatFileSize(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** `update_document` params for a folder move; an empty choice is refused (the backend cannot clear a folder). */
export function moveDocumentParams(folderValue: unknown): { folderId: string } | null {
  const folderId = String(folderValue ?? '').trim();
  return folderId ? { folderId } : null;
}

/** Trimmed legal-hold reason, or null when blank (the reducer requires one). */
export function legalHoldReason(value: unknown): string | null {
  const reason = String(value ?? '').trim();
  return reason || null;
}

/** The active legal hold of a document (newest first when data is inconsistent), or undefined. Rows are `document_legal_hold`. */
export function activeLegalHold(holds: readonly Row[], documentId: unknown): Row | undefined {
  const wanted = String(documentId ?? '');
  return holds
    .filter((hold) => hold.isActive === true && String(hold.documentId ?? hold.document_id ?? '') === wanted)
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0];
}
