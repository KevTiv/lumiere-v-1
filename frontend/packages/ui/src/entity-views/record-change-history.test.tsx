import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../i18n/src/locales/en.json";
import type { AccountMoveHistoryEntry } from "@lumiere/query-hooks/hooks/account-move-history-model";
import { RecordChangeHistory } from "./record-change-history";

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { [key: string]: unknown }) => {
      const value = key
        .split(".")
        .reduce<unknown>(
          (root, part) =>
            root != null && typeof root === "object"
              ? (root as { [key: string]: unknown })[part]
              : undefined,
          en,
        );
      return String(value ?? key).replace(
        /\{\{(\w+)\}\}/g,
        (_: string, name: string) => String(params?.[name] ?? ""),
      );
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
    {
      field: "name",
      before: "<img src=x onerror=alert(1)>",
      after: "Reviewed expense",
    },
    { field: "partner_id", before: null, after: "18446744073709551615" },
  ],
};

describe("record changes", () => {
  it("shows exact before/after values as escaped text and identifies the actual line", () => {
    render(<RecordChangeHistory state="ready" entries={[entry]} />);
    expect(screen.getByText("Line 9007199254740993 updated")).toBeTruthy();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("18446744073709551615")).toBeTruthy();
    expect(screen.getByText("No value")).toBeTruthy();
    expect(screen.getByText("Partner reference")).toBeTruthy();
    expect(screen.getByTestId("record-changes-coverage").textContent).toContain(
      "other operations and earlier changes are not included",
    );
    expect(
      document.querySelector("summary")?.getAttribute("tabindex"),
    ).toBeNull();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(
      entry.occurredAt,
    );
  });

  it.each(["loading", "denied", "error"] as const)(
    "hides cached values when %s instead of showing an empty successful history",
    (state) => {
      render(<RecordChangeHistory state={state} entries={[entry]} />);
      expect(screen.getByTestId(`record-changes-${state}`)).toBeTruthy();
      expect(screen.queryByText("Reviewed expense")).toBeNull();
      expect(screen.queryByTestId("record-changes-empty")).toBeNull();
    },
  );

  it("can continue through an empty filtered page without claiming there are no more changes", () => {
    const next = vi.fn();
    render(
      <RecordChangeHistory
        state="ready"
        entries={[]}
        hasMore
        onLoadMore={next}
      />,
    );
    expect(screen.getByTestId("record-changes-empty").textContent).toContain(
      "Continue to check the next page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more changes" }));
    expect(next).toHaveBeenCalledOnce();
  });

  it("offers only read refresh/pagination controls and keeps errors distinct from history", () => {
    const refresh = vi.fn();
    render(
      <RecordChangeHistory
        state="error"
        entries={[entry]}
        onRefresh={refresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: /approve|propose|apply/i }),
    ).toBeNull();
  });
});
