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
    .filter((hold) => (hold.isActive ?? hold.is_active) === true && String(hold.documentId ?? hold.document_id ?? '') === wanted)
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0];
}

/** Rows (signature requests, external refs, ...) belonging to one document, newest id first. */
export function rowsForDocument(rows: readonly Row[], documentId: unknown): Row[] {
  const wanted = String(documentId ?? '');
  return rows
    .filter((row) => String(row.documentId ?? row.document_id ?? '') === wanted)
    .sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
}

/** Number of signers in a `signers_json` payload; never exposes who they are. 0 when absent or unparsable. */
export function signerCount(signersJson: unknown): number {
  if (typeof signersJson !== 'string' || !signersJson.trim()) return 0;
  try {
    const parsed: unknown = JSON.parse(signersJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** Signature request rows reduced to the non-personal columns shown on the document page. */
export function signatureRequestRows(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    provider: row.provider,
    requestedAt: row.requestedAt ?? row.requested_at,
    completedAt: row.completedAt ?? row.completed_at,
    signerCount: signerCount(row.signersJson ?? row.signers_json),
  }));
}

/** External reference rows reduced to the columns the row actually carries. */
export function externalRefRows(rows: readonly Row[]): Row[] {
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    externalId: row.externalId ?? row.external_id,
    lastDirection: row.lastDirection ?? row.last_direction,
    lastSyncAt: row.lastSyncAt ?? row.last_sync_at,
  }));
}
