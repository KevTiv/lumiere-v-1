import assert from "node:assert/strict";
import test from "node:test";
import {
  fleetCompanyRows,
  fleetHistoryRows,
  fleetVehicleRows,
  fleetVehicleTypes,
} from "./fleet-workspace";

test("fleet reads fail closed without a company and exclude other organizations and companies", () => {
  const rows = [
    { id: "1", organization_id: "7", company_id: "8" },
    { id: "2", organizationId: 7, companyId: 9 },
    { id: "3", organization_id: 6, company_id: 8 },
    { id: "4", company_id: 8 },
    { id: "5", organization_id: 7, company_id: { some: 8 } },
  ];
  assert.deepEqual(fleetCompanyRows(rows, 7n, undefined), []);
  assert.deepEqual(
    fleetCompanyRows(rows, 7n, 8n).map((row) => row.id),
    ["1", "5"],
  );
});

test("organization-wide service types require explicit absence of company scope", () => {
  const rows = [
    { id: "1", organization_id: 7, company_id: null },
    { id: "2", organization_id: 7, company_id: { none: [] } },
    { id: "3", organization_id: 7 },
    { id: "4", organization_id: 9, company_id: null },
    { id: "5", organization_id: 7, company_id: 9 },
  ];
  assert.deepEqual(
    fleetCompanyRows(rows, 7n, 8n, true).map((row) => row.id),
    ["1", "2"],
  );
  assert.deepEqual(fleetCompanyRows(rows, 7n, 8n), []);
});

test("vehicle normalization keeps registration and manual odometer with usable enum filters", () => {
  const [row] = fleetVehicleRows([
    {
      id: "9007199254740993",
      status: { tag: "Maintenance" },
      licensePlate: { some: "RAA 201" },
      vehicleType: "truck",
      odometerKm: { some: 40050 },
    },
  ]);
  assert.equal(row?.id, "9007199254740993");
  assert.equal(row?.status, "maintenance");
  assert.equal(row?.license_plate, "RAA 201");
  assert.equal(row?.odometer_km, 40050);
});

test("vehicle type facets contain only distinct types in the authorized collection", () => {
  const scoped = fleetCompanyRows(
    [
      { id: 1, organizationId: 7, companyId: 8, vehicleType: "truck" },
      { id: 2, organizationId: 7, companyId: 8, vehicleType: "van" },
      { id: 3, organizationId: 7, companyId: 8, vehicleType: "truck" },
      { id: 4, organizationId: 7, companyId: 9, vehicleType: "car" },
      { id: 5, organizationId: 7, companyId: 8, vehicleType: "" },
    ],
    7n,
    8n,
  );
  assert.deepEqual(fleetVehicleTypes(fleetVehicleRows(scoped)), [
    "truck",
    "van",
  ]);
});

test("history uses authorized names and retains real currency and exact accounting identity", () => {
  const rows = fleetHistoryRows(
    [
      {
        id: 1,
        vehicle_id: 8,
        service_type_id: 12,
        cost_amount: 50000,
        currency_id: 3,
        account_move_id: "9007199254740993",
        inspector_id: 42,
      },
      {
        id: 2,
        vehicleId: 99,
        serviceTypeId: 22,
        costAmount: null,
        currencyId: null,
        outcome: { Failed: [] },
      },
    ],
    {
      vehicles: [{ id: 8, name: "Delivery truck" }],
      serviceTypes: [{ id: 12, name: "Oil service" }],
      employees: [],
      currencies: [{ id: 3, code: "RWF" }],
    },
  );
  assert.equal(rows[0]?.vehicle_name, "Delivery truck");
  assert.equal(rows[0]?.service_type_name, "Oil service");
  assert.equal(rows[0]?.inspector_name, "#42");
  assert.equal(rows[0]?.currency_name, "RWF");
  assert.equal(rows[0]?.account_move_id, "9007199254740993");
  assert.equal(rows[1]?.vehicle_name, "#99");
  assert.equal(rows[1]?.currency_name, "—");
  assert.equal(rows[1]?.cost_amount, null);
  assert.equal(rows[1]?.outcome, "failed");
});
