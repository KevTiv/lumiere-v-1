import { parseStrictU64 } from '@lumiere/erp-shared/u64';

import {
  AmbiguousOperationEffectError,
  type CanonicalRecordRef,
} from './operation-effect';

type Projection = Readonly<Record<string, unknown>>;

function field(row: Projection, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function exactRow(
  rows: readonly Projection[],
  idField: [string, string],
  id: bigint,
  label: string,
): Projection | null {
  const matches = rows.filter(
    (row) => parseStrictU64(field(row, idField[0], idField[1])) === id,
  );
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one ${label}, found ${matches.length}`,
    );
  }
  return matches[0] ?? null;
}

function scoped(
  row: Projection,
  organizationId: bigint,
  companyId?: bigint,
): boolean {
  if (
    parseStrictU64(field(row, 'organizationId', 'organization_id')) !==
    organizationId
  ) {
    return false;
  }
  return (
    companyId == null ||
    parseStrictU64(field(row, 'companyId', 'company_id')) === companyId
  );
}

export interface QualityCheckEffectRef extends CanonicalRecordRef {
  readonly resource: 'quality-checks';
  readonly workorderId: string;
  readonly state: 'none' | 'pass' | 'fail';
}

export function resolveWorkorderQualityEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint,
  workorderId: bigint,
  expectedState: QualityCheckEffectRef['state'],
): QualityCheckEffectRef | null {
  const matches = rows.filter(
    (row) =>
      scoped(row, organizationId, companyId) &&
      parseStrictU64(field(row, 'workorderId', 'workorder_id')) === workorderId,
  );
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one workorder quality check, found ${matches.length}`,
    );
  }
  const row = matches[0];
  if (!row) return null;
  const state = String(
    field(row, 'qualityState', 'quality_state') ?? '',
  ).toLowerCase();
  const completed = String(row.status ?? '').toLowerCase() === 'completed';
  if (state !== expectedState || (expectedState !== 'none' && !completed)) {
    return null;
  }
  const id = parseStrictU64(row.id);
  if (id == null) return null;
  return {
    resource: 'quality-checks',
    id: id.toString(),
    workorderId: workorderId.toString(),
    state: expectedState,
  };
}

export function resolveBomByproductEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint,
  bomId: bigint,
  productId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter(
    (row) =>
      scoped(row, organizationId, companyId) &&
      parseStrictU64(field(row, 'bomId', 'bom_id')) === bomId &&
      parseStrictU64(field(row, 'productId', 'product_id')) === productId,
  );
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one BOM byproduct, found ${matches.length}`,
    );
  }
  const id = matches[0] ? parseStrictU64(matches[0].id) : null;
  return id == null
    ? null
    : { resource: 'mrp-bom-byproducts', id: id.toString() };
}

export function resolveManufacturingScrapEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint,
  productionId: bigint,
  requestId: string,
): CanonicalRecordRef | null {
  const reference = `MO/${productionId}/SCRAP/${requestId}`;
  const matches = rows.filter(
    (row) =>
      scoped(row, organizationId, companyId) &&
      parseStrictU64(field(row, 'productionId', 'production_id')) ===
        productionId &&
      row.scrapped === true &&
      row.reference === reference,
  );
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one manufacturing scrap move, found ${matches.length}`,
    );
  }
  const id = matches[0] ? parseStrictU64(matches[0].id) : null;
  return id == null ? null : { resource: 'stock-moves', id: id.toString() };
}

export function resolveReplenishmentScheduleEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint,
  ruleId: bigint,
): CanonicalRecordRef | null {
  const matches = rows.filter(
    (row) =>
      scoped(row, organizationId, companyId) &&
      parseStrictU64(field(row, 'ruleId', 'rule_id')) === ruleId,
  );
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one replenishment run job, found ${matches.length}`,
    );
  }
  const id = matches[0]
    ? parseStrictU64(field(matches[0], 'scheduledId', 'scheduled_id'))
    : null;
  return id == null
    ? null
    : { resource: 'replenishment-run-jobs', id: id.toString() };
}

export function resolveTimesheetStatusEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint | null,
  timesheetId: bigint,
  status: 'validated' | 'rejected',
): CanonicalRecordRef | null {
  const row = exactRow(rows, ['id', 'id'], timesheetId, 'timesheet');
  if (!row || !scoped(row, organizationId, companyId ?? undefined)) return null;
  return field(row, 'validationStatus', 'validation_status') === status
    ? { resource: 'timesheets', id: timesheetId.toString() }
    : null;
}

export interface TimesheetBillingEffectRef extends CanonicalRecordRef {
  readonly resource: 'timesheets';
  readonly invoiceId: string;
}

export function resolveTimesheetBillingEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  companyId: bigint,
  timesheetId: bigint,
): TimesheetBillingEffectRef | null {
  const row = exactRow(rows, ['id', 'id'], timesheetId, 'timesheet');
  if (!row || !scoped(row, organizationId, companyId)) return null;
  if (field(row, 'validationStatus', 'validation_status') !== 'validated') {
    return null;
  }
  const invoiceId = parseStrictU64(
    field(row, 'timesheetInvoiceId', 'timesheet_invoice_id'),
  );
  return invoiceId == null
    ? null
    : {
        resource: 'timesheets',
        id: timesheetId.toString(),
        invoiceId: invoiceId.toString(),
      };
}

export function resolveAcknowledgedIotActionEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  actionId: bigint,
): CanonicalRecordRef | null {
  const row = exactRow(rows, ['id', 'id'], actionId, 'IoT action');
  if (!row || !scoped(row, organizationId)) return null;
  return row.status === 'Acknowledged' &&
    field(row, 'acknowledgedAt', 'acknowledged_at') != null
    ? { resource: 'iot-actions', id: actionId.toString() }
    : null;
}

function u64Bytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value);
  return bytes;
}

function framed(bytes: Uint8Array): Uint8Array[] {
  return [u64Bytes(BigInt(bytes.length)), bytes];
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

/** Stable COV-19 key; byte framing mirrors `post_message_key` in Rust. */
export async function computePostMessageKey(input: {
  readonly model: string;
  readonly resId: bigint;
  readonly body: string;
  readonly parentId: bigint | null;
  readonly attachmentIds: readonly bigint[];
}): Promise<string> {
  const encoder = new TextEncoder();
  const parts = [
    ...framed(encoder.encode(input.model)),
    u64Bytes(input.resId),
    new Uint8Array([input.parentId == null ? 0 : 1]),
    ...(input.parentId == null ? [] : [u64Bytes(input.parentId)]),
    u64Bytes(BigInt(input.attachmentIds.length)),
    ...input.attachmentIds.map(u64Bytes),
    ...framed(encoder.encode(input.body)),
  ];
  const size = parts.reduce((total, part) => total + part.length, 0);
  const canonical = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    canonical.set(part, offset);
    offset += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', canonical);
  return `sha256:${hex(new Uint8Array(digest))}`;
}

export function resolvePostedMessageEffect(
  rows: readonly Projection[],
  organizationId: bigint,
  messageKey: string,
): CanonicalRecordRef | null {
  const matches = rows.filter((row) => {
    if (!scoped(row, organizationId)) return false;
    const raw = row.metadata;
    if (typeof raw !== 'string') return false;
    try {
      return (
        (JSON.parse(raw) as { message_key?: unknown }).message_key ===
        messageKey
      );
    } catch {
      return false;
    }
  });
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one posted message, found ${matches.length}`,
    );
  }
  const id = matches[0] ? parseStrictU64(matches[0].id) : null;
  return id == null ? null : { resource: 'mail-messages', id: id.toString() };
}
