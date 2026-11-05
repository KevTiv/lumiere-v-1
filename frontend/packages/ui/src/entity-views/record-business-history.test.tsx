import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../i18n/src/locales/en.json";

const controls = vi.hoisted(() => ({
  session: { organizationId: 7, activeCompanyId: 11 as number | null, activeCompanyReady: true, identity: "ab".repeat(32) as string | null },
  company: 11 as number | null, ready: true, allowed: true,
  policies: [{ resource: "business_history", action: "read", effect: "allow" }],
  read: vi.fn(), sourceRead: vi.fn(), activityRead: vi.fn(),
  query: { isPending: false, isFetching: false, isFetchingNextPage: false, isError: false, error: null as unknown,
    hasNextPage: false, data: { pages: [] as { data: unknown[]; coverage: { status: "partial"; message: string } }[] }, refetch: vi.fn(), fetchNextPage: vi.fn() },
  sources: { isPending: false, isFetching: false, isError: false, error: null as unknown,
    hasNextPage: false, data: { pages: [] as { data: unknown[]; coverage: { status: "partial"; message: string } }[] }, refetch: vi.fn(), fetchNextPage: vi.fn() },
}));

vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => controls.session }));
vi.mock("@lumiere/query-hooks/hooks/use-operating-company", () => ({ useOperatingCompanyId: () => controls.company }));
vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ currentUser: { id: "actor" }, roles: [], policies: controls.policies,
  permissionsReady: controls.ready, checkPermission: () => ({ allowed: controls.allowed }) }) }));
vi.mock("@lumiere/query-hooks/hooks/business-history", () => ({
  BusinessHistoryReadError: class extends Error { constructor(readonly status: number) { super("Unavailable"); } },
  useBusinessHistory: (scope: unknown, enabled: boolean) => { controls.read(scope, enabled); return controls.query; },
  useBusinessHistorySources: (scope: unknown, enabled: boolean) => { controls.sourceRead(scope, enabled); return controls.sources; },
  useBusinessHistoryActivity: (scope: unknown, enabled: boolean) => { controls.activityRead(scope, enabled); return controls.query; },
}));
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ i18n: { language: "en" },
  t: (key: string, options?: Record<string, unknown>) => {
    const value = key.split(".").reduce<unknown>((root, part) => root !== null && typeof root === "object" ? (root as Record<string, unknown>)[part] : undefined, en);
    return String(value ?? options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
  } }) }));

import { BusinessHistoryReadError } from "@lumiere/query-hooks/hooks/business-history";
import { ModuleBusinessHistory, RecordBusinessHistory } from "./record-business-history";

const entry = () => ({ id: "org:19", operation: "update_sales_order", actorIdentity: "cd".repeat(32),
  occurredAt: "2026-11-05T12:30:00Z", changedResource: "sale-orders", changedRecordId: "9007199254740993",
  changes: [{ field: "name", before: "Old", after: "Authorized order value" }] });
const source = () => ({ id: "20", kind: "import", jobId: "9007199254740993", rowNumber: 2,
  tableName: "sale_order", status: "success", importedAt: "2026-11-05T12:00:00Z",
  fileName: "<script>source.csv", contentSha256: "ab".repeat(32), verification: "tracked-import", review: null });
const coverage = { status: "partial" as const, message: "Producer coverage is partial." };
afterEach(cleanup);
beforeEach(() => {
  Object.assign(controls.session, { organizationId: 7, activeCompanyId: 11, activeCompanyReady: true, identity: "ab".repeat(32) });
  controls.company = 11; controls.ready = true; controls.allowed = true;
  controls.policies = [{ resource: "business_history", action: "read", effect: "allow" }];
  Object.assign(controls.query, { isPending: false, isFetching: false, isFetchingNextPage: false, isError: false, error: null,
    hasNextPage: false, data: { pages: [{ data: [entry()], coverage }] } });
  Object.assign(controls.sources, { isPending: false, isFetching: false, isError: false, error: null,
    hasNextPage: false, data: { pages: [{ data: [source()], coverage }] } });
  vi.clearAllMocks();
});

describe("shared business history authority and evidence", () => {
  const open = () => render(<RecordBusinessHistory tableName="sale_order" recordId="18446744073709551615" />);

  it("uses exact record scope and renders verified import rows separately from business changes", () => {
    open();
    expect(controls.read.mock.calls.at(-1)).toEqual([expect.objectContaining({ organizationId: 7, companyId: "11", resource: "sale_order", recordId: "18446744073709551615" }), true]);
    expect(screen.getByText("Authorized order value")).toBeTruthy();
    expect(screen.getByText("Import 9007199254740993 · import row 2")).toBeTruthy();
    expect(screen.getByText("<script>source.csv")).toBeTruthy();
    expect(screen.getByText("Submitted content hash")).toBeTruthy();
    expect(screen.queryByText("Original file hash")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText(/Line 9007199/)).toBeNull();
  });

  it("hides both cached changes and sources immediately on access revocation or loading", () => {
    const view = open();
    controls.allowed = false;
    view.rerender(<RecordBusinessHistory tableName="sale_order" recordId="18446744073709551615" />);
    expect(controls.read.mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.queryByText("Authorized order value")).toBeNull();
    expect(screen.queryByText("<script>source.csv")).toBeNull();
    controls.allowed = true; controls.ready = false;
    view.rerender(<RecordBusinessHistory tableName="sale_order" recordId="18446744073709551615" />);
    expect(screen.getByText("Loading changes…")).toBeTruthy();
    expect(screen.queryByText("Authorized order value")).toBeNull();
  });

  it("does not infer a company or accept an unsafe rounded record identity", () => {
    controls.company = null;
    const view = open();
    expect(controls.read.mock.calls.at(-1)?.[1]).toBe(false);
    controls.company = 11;
    view.rerender(<RecordBusinessHistory tableName="sale_order" recordId={Number.MAX_SAFE_INTEGER + 2} />);
    expect(controls.read.mock.calls.at(-1)?.[1]).toBe(false);
    view.rerender(<RecordBusinessHistory tableName="sale_order" recordId="12" companyId="22" />);
    expect(controls.read.mock.calls.at(-1)?.[1]).toBe(false);
  });

  it("rekeys reads on company, actor, record and policy changes", () => {
    const view = open();
    const first = controls.read.mock.calls.at(-1)?.[0];
    controls.session.identity = "ef".repeat(32);
    controls.session.activeCompanyId = 22; controls.company = 22;
    controls.policies = [{ resource: "contact", action: "read", effect: "deny" }];
    controls.query.isPending = true; controls.sources.isPending = true;
    view.rerender(<RecordBusinessHistory tableName="contact" recordId="13" />);
    expect(controls.read.mock.calls.at(-1)?.[0]).toMatchObject({ resource: "contact", recordId: "13", companyId: "22", actorIdentity: "ef".repeat(32) });
    expect(controls.read.mock.calls.at(-1)?.[0]).not.toEqual(first);
    expect(screen.queryByText("Authorized order value")).toBeNull();
    expect(screen.queryByText("<script>source.csv")).toBeNull();
  });

  it("keeps sparse history pageable and makes reads only on explicit callbacks", () => {
    controls.query.data.pages[0]!.data = []; controls.query.hasNextPage = true;
    controls.sources.data.pages[0]!.data = []; controls.sources.hasNextPage = true;
    open();
    expect(screen.getByText("No visible changes on this page. Continue to inspect the next page.")).toBeTruthy();
    expect(controls.query.fetchNextPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Load more changes"));
    fireEvent.click(screen.getByText("Load more sources"));
    expect(controls.query.fetchNextPage).toHaveBeenCalledOnce();
    expect(controls.sources.fetchNextPage).toHaveBeenCalledOnce();
  });

  it("keeps source failures distinct from empty provenance and hides stale evidence", () => {
    controls.sources.isError = true; controls.sources.error = new BusinessHistoryReadError(503);
    open();
    expect(screen.getByText("Source history could not be loaded. Previously loaded sources are hidden.")).toBeTruthy();
    expect(screen.queryByText("<script>source.csv")).toBeNull();
    expect(screen.getByText("Authorized order value")).toBeTruthy();
  });

  it("labels verified original hashes as a prepared derivative without inventing original rows", () => {
    controls.sources.data.pages[0]!.data = [{ ...source(), sourceAdmissionId: "ab".repeat(16), sourceSha256: "cd".repeat(32), sourceRelationship: "user_prepared_derivative" }];
    open();
    expect(screen.getByText("Submitted content hash")).toBeTruthy();
    expect(screen.getByText("Original file hash")).toBeTruthy();
    expect(screen.getByText("The submitted data was prepared from this source file. This relationship does not establish an original file row.")).toBeTruthy();
  });

  it("shows captured summary events without inventing a comparison", () => {
    controls.query.data.pages[0]!.data = [{ ...entry(), changes: [] }];
    open();
    expect(screen.getByText("Recorded: update sales order")).toBeTruthy();
    expect(screen.getByText("This event has no captured before and after values available to your current access.")).toBeTruthy();
    expect(screen.queryByText("Before this save")).toBeNull();
  });

  it("uses the same current authority and coverage for module activity", () => {
    render(<ModuleBusinessHistory moduleId="warehouse" />);
    expect(controls.activityRead.mock.calls.at(-1)).toEqual([expect.objectContaining({ module: "warehouse", companyId: "11" }), true]);
    expect(screen.getByText("Producer coverage is partial.")).toBeTruthy();
    expect(screen.queryByText("Sources")).toBeNull();
  });

  it("normalizes the existing expense report table alias before querying", () => {
    render(<RecordBusinessHistory tableName="hr_expense_sheet" recordId="12" />);
    expect(controls.read.mock.calls.at(-1)?.[0]).toMatchObject({ resource: "expense_sheet", recordId: "12" });
    expect(controls.sourceRead.mock.calls.at(-1)?.[0]).toMatchObject({ resource: "expense_sheet", recordId: "12" });
  });

  it.each(["changes", "sources"])("hides both cached panels after a denied %s read and requires both fresh reads to recover", async (kind) => {
    const deniedQuery = kind === "changes" ? controls.query : controls.sources;
    deniedQuery.isError = true; deniedQuery.error = new BusinessHistoryReadError(403);
    const view = open();
    expect(screen.queryByText("Authorized order value")).toBeNull();
    expect(screen.queryByText("<script>source.csv")).toBeNull();
    deniedQuery.isError = false; deniedQuery.error = null;
    view.rerender(<RecordBusinessHistory tableName="sale_order" recordId="18446744073709551615" />);
    expect(screen.queryByText("Authorized order value")).toBeNull();
    expect(screen.queryByText("<script>source.csv")).toBeNull();
    controls.query.refetch.mockResolvedValueOnce({ status: "success" });
    controls.sources.refetch.mockResolvedValueOnce({ status: "success" });
    fireEvent.click(screen.getByText("Refresh history and sources"));
    expect(await screen.findByText("Authorized order value")).toBeTruthy();
    expect(screen.getByText("<script>source.csv")).toBeTruthy();
    expect(controls.query.refetch).toHaveBeenCalledOnce();
    expect(controls.sources.refetch).toHaveBeenCalledOnce();
  });

  it("links only an exact saved source review binding within the current company", () => {
    controls.sources.data.pages[0]!.data = [{ ...source(), review: { batchId: "24", itemId: "700", revision: 3 } }];
    open();
    const link = screen.getByRole("link", { name: "Open source review" });
    expect(link.getAttribute("href")).toBe("/settings?section=imports&sourceReview=24&sourceReviewCompany=11&sourceReviewItem=700&sourceReviewRevision=3#source-review-history");
    expect(screen.getByText("Review item 700 · saved revision 3")).toBeTruthy();
  });
});
