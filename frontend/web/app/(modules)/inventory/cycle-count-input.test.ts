import assert from "node:assert/strict";
import test from "node:test";
import { CYCLE_COUNT_PERMISSIONS, assertCycleCountScope, cycleCountId, cycleCountQuantity, prepareCycleCountLine } from "./cycle-count-input";

const message = "Invalid count";
const input = { cycleCountId: "90071992547409931", productId: "90071992547409932", locationId: "90071992547409933", uomId: "90071992547409934", stockUomId: "90071992547409934", quantity: "0.125" };

test("count input preserves large native IDs and its exact stock unit", () => {
  const result = prepareCycleCountLine(input, message);
  assert.equal(result.cycleCountId, 90071992547409931n);
  assert.equal(result.params.productId, 90071992547409932n);
  assert.equal(result.params.locationId, 90071992547409933n);
  assert.equal(result.params.uomId, 90071992547409934n);
  assert.equal(result.params.qtyCounted, 0.125);
  assert.equal(prepareCycleCountLine({ ...input, quantity: "0" }, message).params.qtyCounted, 0);
});

test("blank, negative and nonfinite count values never become zero", () => {
  for (const value of ["", " ", "bad", "-1", "0x10", "Infinity", "1e999", NaN, Infinity, -1, null, undefined, false, {}]) {
    assert.throws(() => cycleCountQuantity(value, message), /Invalid count/);
  }
  assert.equal(cycleCountQuantity("1e-3", message), 0.001);
});

test("missing, fractional, unsafe or out-of-range record IDs cannot dispatch", () => {
  for (const value of ["", "0", "-1", "1.5", Number.MAX_SAFE_INTEGER + 1, "18446744073709551616", null]) {
    assert.throws(() => cycleCountId(value, message), /Invalid count/);
  }
});

test("a different or missing stock unit cannot silently change the counted quantity meaning", () => {
  assert.throws(() => prepareCycleCountLine({ ...input, stockUomId: 5n }, message), /Invalid count/);
  assert.throws(() => prepareCycleCountLine({ ...input, stockUomId: undefined }, message), /Invalid count/);
});

test("scope assertions reject unmount, company/account changes and permission revocation", () => {
  const expected = { organizationId: "1", companyId: "2", actorId: "reader" };
  const current = { ...expected, mounted: true, allowed: true };
  assert.doesNotThrow(() => assertCycleCountScope(expected, current, message));
  for (const change of [{ mounted: false }, { allowed: false }, { organizationId: "3" }, { companyId: "3" }, { companyId: "" }, { actorId: "other" }, { actorId: "" }]) {
    assert.throws(() => assertCycleCountScope(expected, { ...current, ...change }, message), /Invalid count/);
  }
});

test("count operations keep their native permission resources and actions", () => {
  assert.deepEqual(CYCLE_COUNT_PERMISSIONS, {
    plan: { resource: "stock_cycle_count", action: "create" },
    start: { resource: "stock_cycle_count", action: "write" },
    line: { resource: "stock_count_sheet", action: "create" },
    validate: { resource: "stock_cycle_count", action: "write" },
    post: { resource: "stock_cycle_count", action: "write" },
  });
});
