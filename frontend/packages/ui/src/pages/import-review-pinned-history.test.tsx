import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../i18n/src/locales/en.json";

const control = vi.hoisted(() => ({
  actor: "ab".repeat(32), company: 11, missing: false, denied: false, fetch: vi.fn(),
}));
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: control.actor }) }));
vi.mock("@lumiere/ui/hooks/use-identity-label-map", () => ({ useIdentityLabelMap: () => new Map() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => control.fetch(...args) }));
vi.mock("../../../../web/lib/import-review-editor", () => ({ ImportReviewEditor: () => null,
  ReviewRequestError: class extends Error { constructor(message: string) { super(message); } } }));
vi.mock("../../../../web/lib/import-review-bulk", () => ({ ImportReviewBulk: () => null }));
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({
  t: (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((root, part) => root !== null && typeof root === "object" ? (root as Record<string, unknown>)[part] : undefined, en);
    return String(value ?? options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
  },
}) }));

import { ImportReviewPanel } from "../../../../web/lib/import-review-workspace";

const batch = { id: "24", title: "Saved workbook", targetEntity: "source_observation", sourceFile: "history.csv", total: 1, pending: 0, confirmed: 1, excluded: 0 };
const item = { id: "700", state: "confirmed", revision: 5, values: { amount: "999.99" }, confirmedFields: ["amount"], reason: "Current revision",
  reviewedBy: "ab".repeat(32), reviewedAt: "2026-11-05T12:00:00Z",
  source: { key: "row1", label: "Historical source row", source: { file: "history.csv", row: 8, sha256: "cd".repeat(32) }, issue: "Confirmed source",
    fields: [{ key: "amount", label: "Recorded amount", kind: "decimal", required: true, sourceValue: "111.25" }], proposed: { amount: "111.25" } } };
const revision = (number: number) => ({ itemId: "700", revision: number, values: { amount: number === 3 ? "111.25" : "999.99" },
  confirmedFields: ["amount"], state: "confirmed", reason: number === 3 ? "Accepted for this import" : "Current revision", actor: "ab".repeat(32), createdAt: "2026-11-05T11:00:00Z" });

beforeEach(() => {
  control.actor = "ab".repeat(32); control.company = 11; control.missing = false; control.denied = false; control.fetch.mockReset();
  window.history.replaceState(null, "", "/settings?section=imports&sourceReview=24&sourceReviewCompany=11&sourceReviewItem=700&sourceReviewRevision=3#source-review-history");
  control.fetch.mockImplementation(async (path: string) => {
    const url = new URL(path, "https://erp.test");
    if (control.denied && url.pathname.endsWith("/history")) return { ok: false, status: 403, json: async () => ({ error: "History access denied" }) };
    const body = url.pathname.endsWith("/history") ? { history: control.missing ? [revision(2)] : [revision(3), revision(2)], nextBeforeRevision: null }
      : url.pathname === "/api/import-reviews/24" ? { ...batch, items: [item], history: [revision(5)] }
        : { data: [batch] };
    return { ok: true, json: async () => body };
  });
});
afterEach(cleanup);

function open(companyId = 11) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const node = (company: number, organizationId = 7) => <QueryClientProvider client={client}><ImportReviewPanel organizationId={organizationId} companyId={company} allowImport={false} onContinue={() => {}} /></QueryClientProvider>;
  return { ...render(node(companyId)), node };
}

describe("pinned source review history", () => {
  it("loads the exact imported revision and its values when the current item is newer", async () => {
    open();
    expect(await screen.findByText("111.25")).toBeTruthy();
    expect(screen.getByText("Review item 700 · saved revision 3 ·", { exact: false })).toBeTruthy();
    expect(screen.queryByText("999.99")).toBeNull();
    expect(screen.queryByText("Current revision")).toBeNull();
    expect(control.fetch.mock.calls.some(([path]) => String(path).includes("/24/items/700/history?companyId=11&beforeRevision=4"))).toBe(true);
    expect(document.getElementById("source-review-history")?.hasAttribute("open")).toBe(true);
    expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
  });

  it("shows unavailable instead of substituting another saved revision or current values", async () => {
    control.missing = true;
    open();
    expect(await screen.findByText("This exact saved review revision is unavailable. Current values have not been substituted.")).toBeTruthy();
    expect(screen.queryByText("111.25")).toBeNull();
    expect(screen.queryByText("999.99")).toBeNull();
  });

  it("does not carry a company-scoped source link into a different company", async () => {
    const view = open();
    await screen.findByText("111.25");
    view.rerender(view.node(22));
    expect(screen.queryByText("111.25")).toBeNull();
    await waitFor(() => expect(control.fetch.mock.calls.some(([path]) => String(path).includes("companyId=22"))).toBe(true));
    expect(control.fetch.mock.calls.some(([path]) => String(path).includes("items/700/history?companyId=22"))).toBe(false);
  });

  it.each(["actor", "organization"])("hides the pinned snapshot immediately after an %s change", async (kind) => {
    const view = open();
    await screen.findByText("111.25");
    control.denied = true;
    if (kind === "actor") control.actor = "ef".repeat(32);
    view.rerender(view.node(11, kind === "organization" ? 8 : 7));
    expect(screen.queryByText("111.25")).toBeNull();
    expect(await screen.findByText("History access denied")).toBeTruthy();
    expect(screen.queryByText("111.25")).toBeNull();
  });
});
