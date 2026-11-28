import assert from "node:assert/strict";
import test from "node:test";
import {
  canRecordFleetServiceWith,
  fleetAccountingSetupHref,
  fleetServiceChoices,
  missingFleetServiceSetup,
} from "./fleet-service-setup";

const company = { organizationId: 11n, companyId: 12n };
const orgWide = { organizationId: 11n, companyId: { none: [] } };
const otherCompany = { organizationId: 11n, companyId: 13n };
const available = {
  serviceTypes: [
    { ...orgWide, id: 1, isActive: true },
    { ...company, id: 2, is_active: false },
    { ...otherCompany, id: 3, isActive: true },
    { organizationId: 11n, id: 4, isActive: true },
  ],
  journals: [
    { ...company, id: 5, active: false, type: { tag: "General" } },
    { ...otherCompany, id: 6, active: true, type: { tag: "General" } },
    { ...company, id: 7, active: true, type: { Bank: [] } },
    { ...company, id: 8, active: true, type: { tag: "General" } },
  ],
  accounts: [
    { ...company, id: 9, deprecated: true, internalGroup: "Expense" },
    { ...company, id: 10, deprecated: false, internal_group: { tag: "Expense" } },
    { ...otherCompany, id: 11, deprecated: false, internalGroup: "Liability" },
    { ...company, id: 12, deprecated: false, internalGroup: "Income" },
    { ...company, id: 13, deprecated: false, internalGroup: "Liability" },
    { ...company, id: 14, deprecated: false, internalGroup: "Liability", isOffBalance: true },
  ],
};

test("setup diagnoses each missing prerequisite from eligible company choices", () => {
  const choices = fleetServiceChoices(available, 11n, 12n);
  assert.deepEqual(
    Object.values(choices).map((rows) => rows.map((row) => row.id)),
    [[1], [7, 8], [10], [13]],
  );
  assert.deepEqual(missingFleetServiceSetup(choices), []);

  const withoutOffset = fleetServiceChoices(
    {
      ...available,
      accounts: available.accounts.filter((row) => row.id !== 13),
    },
    11n,
    12n,
  );
  assert.deepEqual(missingFleetServiceSetup(withoutOffset), ["offsetAccount"]);
  assert.deepEqual(missingFleetServiceSetup(fleetServiceChoices(available, 14n, 12n)), [
    "serviceType",
    "journal",
    "expenseAccount",
    "offsetAccount",
  ]);
});

test("a stale or out-of-role selection cannot reach the service command", () => {
  const choices = fleetServiceChoices(available, 11n, 12n);
  const form = {
    vehicle_id: "42",
    provider: "Garage",
    cost_amount: "30.50",
    service_type_id: "1",
    journal_id: "8",
    expense_account_id: "10",
    offset_account_id: "13",
  };
  assert.equal(canRecordFleetServiceWith(choices, form), true);
  assert.equal(canRecordFleetServiceWith(choices, { ...form, offset_account_id: "10" }), false);
  assert.equal(canRecordFleetServiceWith(choices, { ...form, journal_id: "6" }), false);
});

test("accounting recovery links target existing tabs and require the specific setup grant", () => {
  assert.equal(
    fleetAccountingSetupHref("journal", () => true),
    "/accounting?tab=account-journals",
  );
  assert.equal(
    fleetAccountingSetupHref("expenseAccount", () => true),
    "/accounting?tab=accounts",
  );
  assert.equal(
    fleetAccountingSetupHref("offsetAccount", () => true),
    "/accounting?tab=accounts",
  );
  assert.equal(
    fleetAccountingSetupHref("serviceType", () => true),
    undefined,
  );
  assert.equal(
    fleetAccountingSetupHref("journal", (_resource, action) => action === "read"),
    undefined,
  );
  assert.equal(
    fleetAccountingSetupHref("journal", (resource) => resource === "account_account"),
    undefined,
  );
  assert.equal(
    fleetAccountingSetupHref("offsetAccount", (_resource, action) => action !== "create"),
    "/accounting?tab=accounts",
  );
});
