import assert from "node:assert/strict";
import test from "node:test";
import {
  fleetFailureIsDefinitive,
  fleetRequestStorageKey,
  prepareFleetHistoryAttempt,
  readFleetHistoryAttempt,
} from "./fleet-request";
const scope = { organizationId: "7", companyId: "8", actorIdentity: "actor" };
const values = {
  vehicle_id: "9007199254740993",
  service_type_id: "12",
  cost_amount: 250,
  journal_id: "2",
  expense_account_id: "3",
  offset_account_id: "4",
  notes: "Garage invoice 21",
};
const attempt = () =>
  prepareFleetHistoryAttempt(
    null,
    scope,
    "recordFleetService",
    values,
    () => "original-key",
  );

test("lost-response reload preserves the exact values and request key", () => {
  const first = attempt();
  const restored = readFleetHistoryAttempt(JSON.stringify(first), scope);
  const retry = prepareFleetHistoryAttempt(
    restored,
    scope,
    "recordFleetService",
    { ...values },
    () => {
      throw new Error("must not create another key");
    },
  );
  assert.equal(retry.clientRequestId, "original-key");
  assert.equal(retry.values.vehicle_id, "9007199254740993");
  assert.deepEqual(retry, first);
});

test("unresolved commands cannot be edited, retargeted, or replaced by another action", () => {
  for (const changed of [
    { ...values, cost_amount: 251 },
    { ...values, vehicle_id: "9" },
    { ...values, notes: "another invoice" },
  ]) {
    assert.throws(
      () =>
        prepareFleetHistoryAttempt(
          attempt(),
          scope,
          "recordFleetService",
          changed,
          () => "new",
        ),
      /unresolved/,
    );
  }
  assert.throws(
    () =>
      prepareFleetHistoryAttempt(
        attempt(),
        { ...scope, companyId: "9" },
        "recordFleetService",
        values,
        () => "new",
      ),
    /unresolved/,
  );
  assert.throws(
    () =>
      prepareFleetHistoryAttempt(
        attempt(),
        scope,
        "recordFleetInspection",
        values,
        () => "new",
      ),
    /unresolved/,
  );
});

test("recovery partitions actor, organization and company and rejects foreign envelopes", () => {
  for (const changed of [
    { ...scope, actorIdentity: "other" },
    { ...scope, organizationId: "9" },
    { ...scope, companyId: "9" },
  ]) {
    assert.notEqual(
      fleetRequestStorageKey(scope),
      fleetRequestStorageKey(changed),
    );
    assert.throws(
      () => readFleetHistoryAttempt(JSON.stringify(attempt()), changed),
      /invalid/,
    );
  }
});

test("malformed recovery never silently generates a replacement request", () => {
  assert.equal(readFleetHistoryAttempt(null, scope), null);
  assert.throws(() => readFleetHistoryAttempt("invalid json", scope));
  assert.throws(
    () =>
      readFleetHistoryAttempt(
        JSON.stringify({ ...attempt(), values: { vehicle_id: "1" } }),
        scope,
      ),
    /invalid/,
  );
  assert.throws(
    () =>
      readFleetHistoryAttempt(
        JSON.stringify({ ...attempt(), clientRequestId: "" }),
        scope,
      ),
    /invalid/,
  );
});

test("only definitive rejection of the first attempt may clear saved identity", () => {
  assert.equal(fleetFailureIsDefinitive({ status: 403 }, false), true);
  assert.equal(fleetFailureIsDefinitive({ status: 422 }, false), true);
  assert.equal(fleetFailureIsDefinitive({ status: 403 }, true), false);
  for (const status of [408, 429, 500, 503])
    assert.equal(fleetFailureIsDefinitive({ status }, false), false);
  assert.equal(fleetFailureIsDefinitive(new Error("lost reply"), false), false);
});
