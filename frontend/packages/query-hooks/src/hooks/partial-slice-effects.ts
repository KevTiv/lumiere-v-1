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
