import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../i18n/src/locales/en.json";
import type { AccountMoveHistoryEntry } from "@lumiere/query-hooks/hooks/account-move-history-model";
import { RecordChangeHistory } from "./record-change-history";

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "en", language: "en" },
    t: (key: string, params?: { [key: string]: unknown }) => {
      const value = key.split(".").reduce<unknown>(
        (root, part) => root != null && typeof root === "object"
          ? (root as { [key: string]: unknown })[part] : undefined,
        en,
      );
      return String(value ?? params?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(params?.[name] ?? ""));
    },
  }),
}));

afterEach(cleanup);
const entry: AccountMoveHistoryEntry = {
  id: "9",
  operation: "update_account_move_line",
  actorIdentity: "ab".repeat(32),
  occurredAt: "2026-10-26T12:30:00Z",
  changedResource: "account-move-lines",
  changedRecordId: "9007199254740993",
  changes: [
    { field: "name", before: "<img src=x onerror=alert(1)>", after: "Reviewed expense" },
    { field: "partner_id", before: null, after: "18446744073709551615" },
  ],
};

const values = (side: "before" | "after") => screen.getAllByTestId(`record-change-${side}`).map((node) => node.textContent);

describe("record changes", () => {
  it("identifies an explicit journal-line addition using only its projected values", () => {
    render(<RecordChangeHistory state="ready" entries={[{ ...entry, operation: "add_account_move_line", changes: [
      { field: "account_id", before: null, after: "18446744073709551615" },
      { field: "currency_id", before: null, after: "9007199254740993" },
    ] }]} />);
    expect(screen.getByTestId("record-change-summary").textContent).toBe("Added journal item: Account and Currency");
    expect(values("before")).toEqual(["No value", "No value"]);
    expect(values("after")).toEqual(["18446744073709551615", "9007199254740993"]);
    expect(screen.queryByText("Description")).toBeNull();
  });
  it("leads with the authorized fields and keeps exact line and actor identities secondary", () => {
    render(<RecordChangeHistory state="ready" entries={[entry]} />);
    const item = screen.getByTestId("record-change-9");
    expect(within(item).getByTestId("record-change-summary").textContent).toBe("Description and Partner reference changed");
    expect(within(item).getByText("Line 9007199254740993")).toBeTruthy();
    expect(within(item).getByTestId("record-change-summary").textContent).not.toContain(entry.changedRecordId);
    expect(within(item).getByTitle(entry.actorIdentity).textContent).toBe("User abababab…ababab");
    expect(within(item).getByText(entry.actorIdentity).tagName).toBe("CODE");
    expect(within(item).getByText("User identity").closest("summary")).toBeTruthy();
    expect(item.querySelector("time")?.getAttribute("dateTime")).toBe(entry.occurredAt);
  });

  it("uses each event's projected fields, without adding a field from another event or a full-record field list", () => {
    const debit: AccountMoveHistoryEntry = { ...entry, id: "10", changes: [{ field: "debit", before: "1.00", after: "2.00" }] };
    const partner: AccountMoveHistoryEntry = { ...entry, id: "11", changes: [{ field: "partner_id", before: null, after: "23" }] };
    render(<RecordChangeHistory state="ready" entries={[debit, partner]} />);
    const debitItem = screen.getByTestId("record-change-10");
    const partnerItem = screen.getByTestId("record-change-11");
    expect(within(debitItem).getByTestId("record-change-summary").textContent).toBe("Debit changed");
    expect([...debitItem.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["Debit"]);
    expect(within(debitItem).queryByText("Credit")).toBeNull();
    expect(within(debitItem).queryByText("Description")).toBeNull();
    expect(within(debitItem).queryByText("Partner reference")).toBeNull();
    expect(within(partnerItem).getByTestId("record-change-summary").textContent).toBe("Partner reference changed");
    expect([...partnerItem.querySelectorAll("dt")].map((node) => node.textContent)).toEqual(["Partner reference"]);
  });

  it("preserves exact decimal/u64 strings and distinguishes null, empty text, and zero", () => {
    const exact: AccountMoveHistoryEntry = { ...entry, changes: [
      { field: "name", before: null, after: "" },
      { field: "debit", before: "9007199254740993.12345678901234567890", after: "0.00" },
      { field: "credit", before: "0", after: "0.00000000000000000001" },
      { field: "partner_id", before: null, after: "18446744073709551615" },
      { field: "analytic_account_id", before: "9007199254740993", after: null },
    ] };
    render(<RecordChangeHistory state="ready" entries={[exact]} />);
    expect(values("before")).toEqual(["No value", "9007199254740993.12345678901234567890", "0", "No value", "9007199254740993"]);
    expect(values("after")).toEqual(["Empty text", "0.00", "0.00000000000000000001", "18446744073709551615", "No value"]);
    expect(screen.getAllByText("Before this save")).toHaveLength(5);
    expect(screen.getAllByText("After this save")).toHaveLength(5);
  });

  it("renders markup only as escaped text on both sides of a change", () => {
    const markup: AccountMoveHistoryEntry = { ...entry, changes: [{ field: "name", before: "<img src=x onerror=alert(1)>", after: "<svg onload=alert(2)>text</svg>" }] };
    render(<RecordChangeHistory state="ready" entries={[markup]} />);
    expect(values("before")).toEqual([markup.changes[0]!.before]);
    expect(values("after")).toEqual([markup.changes[0]!.after]);
    expect(document.querySelector("img[src=x], svg[onload], script")).toBeNull();
  });

  it("uses native disclosures for scope, changes, and full identity without intercepting keyboard events", () => {
    render(<RecordChangeHistory state="ready" entries={[entry]} />);
    const coverage = screen.getByTestId("record-changes-coverage");
    const coverageSummary = within(coverage).getByText("What this history includes");
    const coverageDetails = coverageSummary.closest("details")!;
    expect(coverageSummary.tagName).toBe("SUMMARY");
    expect(coverageDetails.hasAttribute("open")).toBe(false);
    fireEvent.click(coverageSummary);
    expect(coverageDetails.hasAttribute("open")).toBe(true);
    expect(coverage.textContent).toContain("other operations and earlier changes are not included");
    const item = screen.getByTestId("record-change-9");
    const details = item.querySelector("details")!;
    const summary = within(item).getByTestId("record-change-summary").closest("summary")!;
    expect(summary.parentElement).toBe(details);
    expect(summary.hasAttribute("tabindex")).toBe(false);
    expect(summary.getAttribute("role")).toBeNull();
    expect(details.hasAttribute("open")).toBe(false);
    expect(fireEvent.keyDown(summary, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(summary, { key: " " })).toBe(true);
    const wasOpen = details.hasAttribute("open");
    fireEvent.click(summary);
    expect(details.hasAttribute("open")).toBe(!wasOpen);
    const identitySummary = within(item).getByText("User identity");
    const identityDetails = identitySummary.closest("details")!;
    expect(identitySummary.tagName).toBe("SUMMARY");
    expect(identityDetails.hasAttribute("open")).toBe(false);
    fireEvent.click(identitySummary);
    expect(identityDetails.hasAttribute("open")).toBe(true);
    expect(identityDetails.querySelector("code")?.textContent).toBe(entry.actorIdentity);
  });

  it.each(["loading", "denied", "error"] as const)("hides cached values when %s instead of showing an empty successful history", (state) => {
    render(<RecordChangeHistory state={state} entries={[entry]} hasMore onLoadMore={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByTestId(`record-changes-${state}`)).toBeTruthy();
    expect(screen.queryByText("Reviewed expense")).toBeNull();
    expect(screen.queryByTestId("record-change-summary")).toBeNull();
    expect(screen.queryByText(entry.actorIdentity)).toBeNull();
    expect(screen.queryByTestId("record-changes-empty")).toBeNull();
    expect(screen.queryByTestId("record-changes-more")).toBeNull();
  });

  it("can continue through an empty filtered page without claiming there are no more changes", () => {
    const next = vi.fn();
    render(<RecordChangeHistory state="ready" entries={[]} hasMore onLoadMore={next} />);
    expect(screen.getByTestId("record-changes-empty").textContent).toContain("Continue to check the next page");
    fireEvent.click(screen.getByRole("button", { name: "Load more changes" }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("retains the sparse-page continuation while a refresh runs, then replaces it only with the next result", () => {
    const more = vi.fn();
    const props = { state: "ready" as const, entries: [] as AccountMoveHistoryEntry[], hasMore: true, onLoadMore: more };
    const view = render(<RecordChangeHistory {...props} isRefreshing />);
    expect(screen.getByTestId("record-changes-empty").textContent).toContain("Continue to check the next page");
    expect((screen.getByTestId("record-changes-more") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("record-changes-more"));
    expect(more).not.toHaveBeenCalled();
    view.rerender(<RecordChangeHistory {...props} isRefreshing={false} />);
    fireEvent.click(screen.getByTestId("record-changes-more"));
    expect(more).toHaveBeenCalledOnce();
    view.rerender(<RecordChangeHistory {...props} entries={[entry]} hasMore={false} />);
    expect(screen.queryByTestId("record-changes-empty")).toBeNull();
    expect(screen.queryByTestId("record-changes-more")).toBeNull();
    expect(screen.getByTestId("record-change-summary")).toBeTruthy();
  });

  it.each(["refresh", "pagination"] as const)("prevents overlapping reads during %s and restores both controls afterward", (busy) => {
    const refresh = vi.fn(), more = vi.fn();
    const props = { state: "ready" as const, entries: [entry], hasMore: true, onRefresh: refresh, onLoadMore: more };
    const view = render(<RecordChangeHistory {...props} isRefreshing={busy === "refresh"} loadingMore={busy === "pagination"} />);
    const refreshButton = screen.getByRole("button", { name: busy === "refresh" ? "Refreshing changes…" : "Refresh changes" }) as HTMLButtonElement;
    const moreButton = screen.getByTestId("record-changes-more") as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(true);
    expect(moreButton.disabled).toBe(true);
    expect(screen.getByTestId("record-changes").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("record-change-summary")).toBeTruthy();
    fireEvent.click(refreshButton);
    fireEvent.click(moreButton);
    expect(refresh).not.toHaveBeenCalled();
    expect(more).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(busy === "refresh" ? "Refreshing changes…" : "Loading more changes…");
    view.rerender(<RecordChangeHistory {...props} isRefreshing={false} loadingMore={false} />);
    expect((screen.getByRole("button", { name: "Refresh changes" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Load more changes" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more changes" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(more).toHaveBeenCalledOnce();
  });

  it("keeps an error distinct from history while retry is pending and recovers with authorized entries", () => {
    const refresh = vi.fn();
    const props = { entries: [entry], onRefresh: refresh };
    const view = render(<RecordChangeHistory {...props} state="error" isRefreshing />);
    expect((screen.getByRole("button", { name: "Refreshing changes…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("record-changes-error").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("record-change-summary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refreshing changes…" }));
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(<RecordChangeHistory {...props} state="error" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
    view.rerender(<RecordChangeHistory {...props} state="ready" />);
    expect(screen.queryByTestId("record-changes-error")).toBeNull();
    expect(screen.getByText("Reviewed expense")).toBeTruthy();
  });

  it("offers only refresh and pagination buttons, with no record mutation controls", () => {
    render(<RecordChangeHistory state="ready" entries={[entry]} hasMore onRefresh={vi.fn()} onLoadMore={vi.fn()} />);
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Refresh changes", "Load more changes"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /approve|propose|apply|save|undo|revert/i })).toBeNull();
  });
});
