import assert from 'node:assert/strict';
import test from 'node:test';

import { AmbiguousOperationEffectError } from './operation-effect';
import {
  resolveAcknowledgedIotActionEffect,
  resolveBomByproductEffect,
  resolveManufacturingScrapEffect,
  resolveReplenishmentScheduleEffect,
  resolveTimesheetBillingEffect,
  resolveTimesheetStatusEffect,
  resolveWorkorderQualityEffect,
} from './partial-slice-effects';

const scope = { organization_id: '7', company_id: '11' };

test('COV-07e resolves only the exact completed quality disposition', () => {
  const rows = [
    {
      ...scope,
      id: '91',
      workorder_id: '44',
      quality_state: 'pass',
      status: 'completed',
    },
  ];
  assert.deepEqual(resolveWorkorderQualityEffect(rows, 7n, 11n, 44n, 'pass'), {
    resource: 'quality-checks',
    id: '91',
    workorderId: '44',
    state: 'pass',
  });
  assert.equal(resolveWorkorderQualityEffect(rows, 7n, 11n, 44n, 'fail'), null);
});

test('COV-07f uses the request-bound scrap reference', () => {
  const rows = [
    {
      ...scope,
      id: 12,
      production_id: 5,
      scrapped: true,
      reference: 'MO/5/SCRAP/request-a',
    },
  ];
  assert.deepEqual(
    resolveManufacturingScrapEffect(rows, 7n, 11n, 5n, 'request-a'),
    {
      resource: 'stock-moves',
      id: '12',
    },
  );
});

test('COV-07g and COV-06n reject ambiguous exact relations', () => {
  const byproducts = [
    { ...scope, id: 1, bom_id: 2, product_id: 3 },
    { ...scope, id: 4, bom_id: 2, product_id: 3 },
  ];
  assert.throws(
    () => resolveBomByproductEffect(byproducts, 7n, 11n, 2n, 3n),
    AmbiguousOperationEffectError,
  );
  assert.deepEqual(
    resolveReplenishmentScheduleEffect(
      [{ ...scope, scheduled_id: 8, rule_id: 6 }],
      7n,
      11n,
      6n,
    ),
    { resource: 'replenishment-run-jobs', id: '8' },
  );
});

test('COV-10 confirms state and the canonical invoice handoff', () => {
  const rows = [
    {
      ...scope,
      id: 22,
      validation_status: 'validated',
      timesheet_invoice_id: 99,
    },
  ];
  assert.deepEqual(
    resolveTimesheetStatusEffect(rows, 7n, 11n, 22n, 'validated'),
    {
      resource: 'timesheets',
      id: '22',
    },
  );
  assert.deepEqual(resolveTimesheetBillingEffect(rows, 7n, 11n, 22n), {
    resource: 'timesheets',
    id: '22',
    invoiceId: '99',
  });
});

test('COV-16 requires both acknowledged state and timestamp', () => {
  assert.equal(
    resolveAcknowledgedIotActionEffect(
      [
        {
          organization_id: 7,
          id: 3,
          status: 'Acknowledged',
          acknowledged_at: null,
        },
      ],
      7n,
      3n,
    ),
    null,
  );
  assert.deepEqual(
    resolveAcknowledgedIotActionEffect(
      [
        {
          organization_id: 7,
          id: 3,
          status: 'Acknowledged',
          acknowledged_at: 123,
        },
      ],
      7n,
      3n,
    ),
    { resource: 'iot-actions', id: '3' },
  );
});
