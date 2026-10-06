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
