import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePersonalPageLayoutResponse,
  validatePersonalPageLayoutRequest,
  PERSONAL_PAGE_MAX_WIDGETS,
  type PersonalPageLayout,
} from "./personal-page-layout";

const layout: PersonalPageLayout = {
  schemaVersion: 1,
  moduleId: "sales",
  pageId: "orders",
  widgets: [
    {
      id: "first",
      source: "saved",
      widgetId: "18446744073709551615",
      width: 6,
    },
    {
      id: "second",
      source: "saved",
      widgetId: "18446744073709551615",
      width: 12,
    },
  ],
};
const saved = {
  companyId: "9007199254740993",
  moduleId: "sales",
  pageId: "orders",
  revision: "18446744073709551615",
  layout,
};

test("saved page keeps full u64 identities and independently sized placements of one widget", () => {
  const decoded = decodePersonalPageLayoutResponse(saved, {
    companyId: saved.companyId,
    moduleId: "sales",
    pageId: "orders",
  });
  assert.equal(decoded, saved);
  assert.equal(decoded.layout?.widgets[1]?.widgetId, "18446744073709551615");
  assert.equal(decoded.layout?.widgets[1]?.width, 12);
  validatePersonalPageLayoutRequest({
    expectedRevision: saved.revision,
    layout,
  });
});

test("reset and intentionally empty pages are distinct; omitted nullable intent is rejected", () => {
  validatePersonalPageLayoutRequest({ expectedRevision: "8", layout: null });
  validatePersonalPageLayoutRequest({
    expectedRevision: "8",
    layout: { ...layout, widgets: [] },
  });
  for (const request of [
    { layout: null },
    { expectedRevision: null },
    {},
    { expectedRevision: null, layout: null, companyId: "2" },
  ]) {
    assert.throws(() => validatePersonalPageLayoutRequest(request));
  }
});

test("response rejects another route, rounded identity, unknown components and malformed placement keys", () => {
  for (const value of [
    { ...saved, companyId: "2" },
    { ...saved, revision: 9007199254740992 },
    { ...saved, revision: "018" },
    { ...saved, revision: null },
    { ...saved, revision: "18446744073709551616" },
    { ...saved, layout: { ...layout, pageId: "dashboard" } },
    {
      ...saved,
      layout: {
        ...layout,
        widgets: [{ ...layout.widgets[0], component: "<script>" }],
      },
    },
    {
      ...saved,
      layout: {
        ...layout,
        widgets: [{ ...layout.widgets[0], widgetId: "1e4" }],
      },
    },
    {
      ...saved,
      layout: {
        ...layout,
        widgets: [
          { id: "bad/id", source: "builtin", widgetId: "known", width: 6 },
        ],
      },
    },
  ])
    assert.throws(() =>
      decodePersonalPageLayoutResponse(value, {
        companyId: saved.companyId,
        moduleId: "sales",
        pageId: "orders",
      }),
    );
});

test("generated schema enforces limits and semantic validation rejects duplicate instances", () => {
  const widgets = Array.from(
    { length: PERSONAL_PAGE_MAX_WIDGETS },
    (_, index) => ({
      id: `item-${index}`,
      source: "builtin" as const,
      widgetId: `summary-${index}`,
      width: 3 as const,
    }),
  );
  validatePersonalPageLayoutRequest({
    expectedRevision: null,
    layout: { ...layout, widgets },
  });
  for (const rejected of [
    { ...layout, widgets: [...widgets, { ...widgets[0], id: "too-many" }] },
    { ...layout, widgets: [layout.widgets[0], layout.widgets[0]] },
    { ...layout, widgets: [widgets[0], { ...widgets[0], id: "another" }] },
    { ...layout, widgets: [{ ...layout.widgets[0], width: 5 }] },
    { ...layout, pageId: "not--a-page" },
    { ...layout, moduleId: "settings" },
  ])
    assert.throws(() =>
      validatePersonalPageLayoutRequest({
        expectedRevision: null,
        layout: rejected,
      }),
    );
});
