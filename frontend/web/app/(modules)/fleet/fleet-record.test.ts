import assert from 'node:assert/strict';
import test from 'node:test';

import { fleetEnumTag, fleetVehicleRecordHref, rowsOfVehicle } from './fleet-record';

test('a vehicle links to its own page by id', () => {
  assert.equal(fleetVehicleRecordHref({ id: 4 }), '/fleet/vehicles/4');
  assert.equal(fleetVehicleRecordHref({}), undefined);
});

test('enum cells read as their tag', () => {
  assert.equal(fleetEnumTag({ tag: 'Active' }), 'Active');
  assert.equal(fleetEnumTag({ Idle: [] }), 'Idle');
  assert.equal(fleetEnumTag('passed'), 'passed');
  assert.equal(fleetEnumTag(null), '');
});

test('related rows are matched to a vehicle whichever way the id is spelled', () => {
  const rows = [{ id: 1, vehicle_id: 7 }, { id: 2, vehicleId: '7' }, { id: 3, vehicle_id: 8 }];

  assert.deepEqual(rowsOfVehicle(rows, '7').map((row) => row.id), [1, 2]);
});
