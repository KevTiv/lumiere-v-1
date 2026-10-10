/**
 * Pure helpers for `GET /api/query/pos-orders`, the cursor-paginated hot+cold
 * POS order read. Envelope: `{ data: Row[], nextCursor: string | null }`.
 * The endpoint only accepts `companyId`, `cursor` and `limit`: there is no
 * session filter, so {@link filterPosOrdersBySession} narrows loaded pages.
 */

export type PosOrderRow = Record<string, unknown>;

export interface PosOrdersPage {
  rows: PosOrderRow[];
  nextCursor: string | null;
}

export const POS_ORDERS_PAGE_SIZE = 50;

export function buildPosOrdersPath(params: { companyId?: bigint | number | string; cursor?: string | null; limit?: number }): string {
  const query = new URLSearchParams();
  if (params.companyId != null && String(params.companyId) !== '') query.set('companyId', String(params.companyId));
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit != null) query.set('limit', String(params.limit));
  const qs = query.toString();
  return qs ? `/api/query/pos-orders?${qs}` : '/api/query/pos-orders';
}

/** Narrow the envelope; throws on a malformed body so the UI shows its error state. */
export function parsePosOrdersPage(json: unknown): PosOrdersPage {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('POS orders response must be an object');
  }
  const body = json as { data?: unknown; nextCursor?: unknown };
  if (!Array.isArray(body.data)) throw new Error('POS orders response data must be an array');
  const rows = body.data.filter((row): row is PosOrderRow => row !== null && typeof row === 'object' && !Array.isArray(row));
  const nextCursor = typeof body.nextCursor === 'string' && body.nextCursor !== '' ? body.nextCursor : null;
  return { rows, nextCursor };
}

/** Concatenate pages in order, dropping rows already seen (hot/cold overlap while archiving). */
export function mergePosOrderPages(pages: readonly PosOrdersPage[]): PosOrderRow[] {
  const seen = new Set<string>();
  const out: PosOrderRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      const key = row.id == null ? null : String(row.id);
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(row);
    }
  }
  return out;
}

/** Cursor to request next: that of the last loaded page, or null when exhausted. */
export function nextPosOrdersCursor(pages: readonly PosOrdersPage[]): string | null {
  return pages.length === 0 ? null : (pages[pages.length - 1]?.nextCursor ?? null);
}

export function filterPosOrdersBySession(rows: readonly PosOrderRow[], sessionId: bigint | number | string): PosOrderRow[] {
  const wanted = String(sessionId);
  return rows.filter((row) => String(row.sessionId ?? row.session_id ?? '') === wanted);
}
