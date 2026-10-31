import assert from "node:assert/strict";
import test from "node:test";
import type { TFunction } from "i18next";
import { prepareProductCreate } from "./product-create";

const t = ((key: string) => key) as TFunction;
const values = {
  name: "Coffee",
  categId: "2",
  uomId: "3",
  pricelistId: "4",
  standardPrice: 0,
  saleOk: false,
};
const pricelists = [{ id: 4n, currencyId: 5n }];

test("missing, removed and unconfigured price lists reject instead of resolving an unsaved form", () => {
  assert.throws(
    () =>
      prepareProductCreate(
        { ...values, pricelistId: "" },
        pricelists,
        { status: "ready" },
        t,
      ),
    /pricelistRequired/,
  );
  assert.throws(
    () => prepareProductCreate(values, [], { status: "ready" }, t),
    /pricelistUnavailable/,
  );
  assert.throws(
    () => prepareProductCreate(values, [{ id: 4n }], { status: "ready" }, t),
    /currencyRequired/,
  );
});

test("denied, loading and stale price-list reads cannot supply a create request", () => {
  for (const status of ["denied", "error", "loading", "partial"] as const) {
    assert.throws(
      () => prepareProductCreate(values, pricelists, { status }, t),
      /pricelistsUnavailable/,
    );
  }
});

test("missing, non-numeric and unsafe references reject before the legacy numeric converter", () => {
  for (const id of [
    undefined,
    "",
    "invalid",
    "90071992547409931",
    -1,
    true,
    "1e3",
  ]) {
    assert.throws(
      () =>
        prepareProductCreate(
          { ...values, categId: id },
          pricelists,
          { status: "ready" },
          t,
        ),
      /referencesRequired/,
    );
  }
  assert.throws(
    () =>
      prepareProductCreate(
        { ...values, uomId: null },
        pricelists,
        { status: "ready" },
        t,
      ),
    /referencesRequired/,
  );
});

test("invalid name and cost reject while a valid zero cost and false sale flag survive", () => {
  for (const standardPrice of [-1, Infinity, NaN]) {
    assert.throws(
      () =>
        prepareProductCreate(
          { ...values, standardPrice },
          pricelists,
          { status: "ready" },
          t,
        ),
      /valuesRequired/,
    );
  }
  assert.throws(
    () =>
      prepareProductCreate(
        { ...values, name: " " },
        pricelists,
        { status: "ready" },
        t,
      ),
    /valuesRequired/,
  );
  const params = prepareProductCreate(
    values,
    pricelists,
    { status: "ready" },
    t,
  );
  assert.equal(params.currencyId, 5);
  assert.equal(params.pricelistId, 4);
  assert.equal(params.standardPrice, 0);
  assert.equal(params.saleOk, false);
  assert.equal(params.uomPoId, 3);
});

test("creation preserves decimal cost, optional product fields and the existing missing-field defaults", () => {
  const populated = prepareProductCreate(
    {
      ...values,
      standardPrice: "48.125",
      type: "service",
      uomPoId: "6",
      purchaseOk: false,
      defaultCode: "COF-1",
      description: "  Roasted coffee  ",
    },
    pricelists,
    { status: "ready" },
    t,
  );
  assert.equal(populated.standardPrice, 48.125);
  assert.equal(populated.listPrice, 48.125);
  assert.equal(populated.type, "service");
  assert.equal(populated.uomPoId, 6);
  assert.equal(populated.saleOk, false);
  assert.equal(populated.purchaseOk, false);
  assert.equal(populated.defaultCode, "COF-1");
  assert.equal(populated.description, "Roasted coffee");

  const defaults = prepareProductCreate(
    { name: "Coffee", categId: "2", uomId: "3", pricelistId: "4", uomPoId: "" },
    pricelists,
    { status: "ready" },
    t,
  );
  assert.equal(defaults.type, "product");
  assert.equal(defaults.uomPoId, 3);
  assert.equal(defaults.standardPrice, 0);
  assert.equal(defaults.listPrice, 0);
  assert.equal(defaults.saleOk, true);
  assert.equal(defaults.purchaseOk, true);
});
