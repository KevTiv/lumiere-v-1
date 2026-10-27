import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordChangeHistoryProps } from "./record-change-history";

const control = vi.hoisted(() => ({
  session: {
    identity: "ab".repeat(32) as string | null,
    organizationId: 7,
    activeCompanyId: 11 as number | null,
    activeCompanyReady: true,
  },
  ready: true,
  historyAllowed: true,
  user: { id: "actor-1", roles: ["finance"] },
  policies: [
    { resource: "module:accounting", action: "read", effect: "allow" },
  ],
  query: {
    isPending: false,
    isFetching: false,
    isError: false,
    error: null as unknown,
    hasNextPage: false,
    isFetchingNextPage: false,
    data: {
      pages: [
        {
          data: [
            {
              id: "9",
              operation: "update_account_move_line",
              actorIdentity: "cd".repeat(32),
              occurredAt: "2026-10-26T12:30:00Z",
              changedResource: "account-move-lines",
              changedRecordId: "22",
              changes: [
                { field: "name", before: "Old", after: "Authorized value" },
              ],
            },
          ],
        },
      ],
    },
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
  },
  reads: vi.fn(),
  renders: vi.fn(),
}));

vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => control.session,
}));
vi.mock("../lib/rbac-context", () => ({
  useRBAC: () => ({
    currentUser: control.user,
    roles: [],
    policies: control.policies,
    permissionsReady: control.ready,
    checkPermission: (resource: string) => ({
      allowed: resource === "business_history" && control.historyAllowed,
    }),
  }),
}));
vi.mock("@lumiere/query-hooks/hooks/account-move-history", () => ({
  AccountMoveHistoryReadError: class extends Error {
    constructor(readonly status: number) {
      super("Unavailable");
    }
  },
  useAccountMoveHistory: (scope: unknown, enabled: boolean) => {
    control.reads(scope, enabled);
    return control.query;
  },
}));
vi.mock("./record-change-history", () => ({
  RecordChangeHistory: (props: RecordChangeHistoryProps) => {
    control.renders(props);
    return <div data-testid="history-state" data-state={props.state}>
      {props.entries
        .map((entry) => entry.changes.map((change) => change.after))
        .join(",")}
    </div>;
  },
}));

import { AccountMoveHistoryReadError } from "@lumiere/query-hooks/hooks/account-move-history";
import { AccountMoveChanges } from "./account-move-changes";

afterEach(cleanup);
beforeEach(() => {
  control.reads.mockClear();
  control.renders.mockClear();
  control.query.refetch.mockClear();
  control.query.fetchNextPage.mockClear();
  Object.assign(control.session, {
    identity: "ab".repeat(32),
    organizationId: 7,
    activeCompanyId: 11,
    activeCompanyReady: true,
  });
  control.user = { id: "actor-1", roles: ["finance"] };
  control.policies = [{ resource: "module:accounting", action: "read", effect: "allow" }];
  control.ready = true;
  control.historyAllowed = true;
  control.query.isPending = false;
  control.query.isFetching = false;
  control.query.isFetchingNextPage = false;
  control.query.hasNextPage = false;
  control.query.data = { pages: [{ data: [{
    id: "9", operation: "update_account_move_line", actorIdentity: "cd".repeat(32),
    occurredAt: "2026-10-26T12:30:00Z", changedResource: "account-move-lines", changedRecordId: "22",
    changes: [{ field: "name", before: "Old", after: "Authorized value" }],
  }] }] };
  control.query.isError = false;
  control.query.error = null;
});

describe("Accounting history authority", () => {
  const open = () =>
    render(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );

  it("lets an explicit history reader reach server source policy even with module-level source grants", () => {
    open();
    expect(control.reads.mock.calls.at(-1)?.[1]).toBe(true);
    expect(screen.getByTestId("history-state").getAttribute("data-state")).toBe(
      "ready",
    );
    expect(screen.getByText("Authorized value")).toBeTruthy();
  });

  it("uses the resolved operating company when session selection has no value yet", () => {
    control.session.activeCompanyId = null;
    render(
      <AccountMoveChanges organizationId={7} companyId={11n} recordId="99" />,
    );
    expect(control.reads.mock.calls.at(-1)?.[1]).toBe(true);
    expect(control.reads.mock.calls.at(-1)?.[0]).toMatchObject({
      companyId: "11",
    });
    expect(screen.getByText("Authorized value")).toBeTruthy();
  });

  it("hides cached evidence immediately when company scope or history access changes", () => {
    const view = open();
    control.session.activeCompanyId = 12;
    view.rerender(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );
    expect(control.reads.mock.calls.at(-1)?.[1]).toBe(false);
    expect(screen.queryByText("Authorized value")).toBeNull();
    expect(screen.getByTestId("history-state").getAttribute("data-state")).toBe(
      "denied",
    );
    control.session.activeCompanyId = 11;
    control.historyAllowed = false;
    view.rerender(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );
    expect(screen.queryByText("Authorized value")).toBeNull();
  });

  it("does not show previous values during policy loading, permission denial or read failures", () => {
    const view = open();
    control.ready = false;
    view.rerender(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );
    expect(screen.getByTestId("history-state").getAttribute("data-state")).toBe(
      "loading",
    );
    expect(screen.queryByText("Authorized value")).toBeNull();
    control.ready = true;
    control.query.isError = true;
    control.query.error = new AccountMoveHistoryReadError(403);
    view.rerender(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );
    expect(screen.getByTestId("history-state").getAttribute("data-state")).toBe(
      "denied",
    );
    control.query.error = new AccountMoveHistoryReadError(503);
    view.rerender(
      <AccountMoveChanges organizationId={7} companyId={11} recordId="99" />,
    );
    expect(screen.getByTestId("history-state").getAttribute("data-state")).toBe(
      "error",
    );
    expect(screen.queryByText("Authorized value")).toBeNull();
  });
});


describe("Accounting history refresh and scoped recovery", () => {
  const props = () => control.renders.mock.calls.at(-1)?.[0] as RecordChangeHistoryProps;
  const host = { organizationId: 7, companyId: "11", recordId: "9007199254740993" };

  it("forwards refresh separately from initial loading and pagination without dropping authorized entries", () => {
    const view = render(<AccountMoveChanges {...host} />);
    control.query.isFetching = true;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: "ready", isRefreshing: true, loadingMore: false });
    expect(screen.getByText("Authorized value")).toBeTruthy();

    control.query.isFetchingNextPage = true;
    control.query.hasNextPage = true;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ isRefreshing: false, loadingMore: true, hasMore: true });

    control.query.isFetchingNextPage = false;
    control.query.isPending = true;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: "loading", isRefreshing: false, entries: [] });
    expect(screen.queryByText("Authorized value")).toBeNull();
  });

  it("keeps a sparse authorized page pageable and forwards only explicit read callbacks", () => {
    control.query.data = { pages: [{ data: [] }] };
    control.query.hasNextPage = true;
    render(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: "ready", entries: [], hasMore: true });
    expect(control.query.fetchNextPage).not.toHaveBeenCalled();
    expect(control.query.refetch).not.toHaveBeenCalled();
    props().onLoadMore?.();
    props().onRefresh?.();
    expect(control.query.fetchNextPage).toHaveBeenCalledOnce();
    expect(control.query.refetch).toHaveBeenCalledOnce();
    expect(control.reads.mock.calls.at(-1)?.[0]).toMatchObject({ recordId: host.recordId, companyId: host.companyId });
  });

  it("hides old evidence during actor and record transitions and recovers only with the new query result", () => {
    const view = render(<AccountMoveChanges {...host} />);
    expect(screen.getByText("Authorized value")).toBeTruthy();
    const priorScope = control.reads.mock.calls.at(-1)?.[0];
    control.session.identity = "ef".repeat(32);
    control.query.isPending = true;
    view.rerender(<AccountMoveChanges {...host} recordId="18446744073709551615" />);
    expect(control.reads.mock.calls.at(-1)?.[0]).toMatchObject({ actorIdentity: "ef".repeat(32), recordId: "18446744073709551615" });
    expect(control.reads.mock.calls.at(-1)?.[0]).not.toEqual(priorScope);
    expect(props().entries).toEqual([]);
    expect(screen.queryByText("Authorized value")).toBeNull();

    control.query.data.pages[0]!.data[0]!.changes[0]!.after = "New scoped evidence";
    control.query.isPending = false;
    view.rerender(<AccountMoveChanges {...host} recordId="18446744073709551615" />);
    expect(screen.getByText("New scoped evidence")).toBeTruthy();
  });

  it("changes the authorization key and hides cached evidence while refreshed field access loads", () => {
    const view = render(<AccountMoveChanges {...host} />);
    const previousKey = (control.reads.mock.calls.at(-1)?.[0] as { authorizationKey: string }).authorizationKey;
    control.policies = [{ resource: "account.move.line", action: "read:name", effect: "deny" }];
    control.query.isPending = true;
    view.rerender(<AccountMoveChanges {...host} />);
    const nextKey = (control.reads.mock.calls.at(-1)?.[0] as { authorizationKey: string }).authorizationKey;
    expect(nextKey).not.toBe(previousKey);
    expect(props().entries).toEqual([]);
    expect(screen.queryByText("Authorized value")).toBeNull();

    control.query.data = { pages: [{ data: [] }] };
    control.query.isPending = false;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: "ready", entries: [] });
  });

  it.each([401, 403, 404, 503])("hides cached evidence on HTTP %s and restores it only after a successful read", (status) => {
    const view = render(<AccountMoveChanges {...host} />);
    control.query.isError = true;
    control.query.error = new AccountMoveHistoryReadError(status);
    view.rerender(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: status === 503 ? "error" : "denied", entries: [] });
    expect(screen.queryByText("Authorized value")).toBeNull();
    control.query.isError = false;
    control.query.error = null;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(screen.getByText("Authorized value")).toBeTruthy();
  });

  it("hides old evidence when the active organization changes and never offers a refresh for that denied scope", () => {
    const view = render(<AccountMoveChanges {...host} />);
    control.session.organizationId = 8;
    view.rerender(<AccountMoveChanges {...host} />);
    expect(control.reads.mock.calls.at(-1)?.[1]).toBe(false);
    expect(props().entries).toEqual([]);
    expect(props().onRefresh).toBeUndefined();
    expect(screen.queryByText("Authorized value")).toBeNull();
  });

  it("fails closed if pages disagree about an existing history identity", () => {
    const original = control.query.data.pages[0]!.data[0]!;
    control.query.data.pages.push({ data: [{ ...original, changes: [{ field: "name", before: "Old", after: "Conflicting evidence" }] }] });
    render(<AccountMoveChanges {...host} />);
    expect(props()).toMatchObject({ state: "error", entries: [] });
    expect(screen.queryByText("Authorized value")).toBeNull();
    expect(screen.queryByText("Conflicting evidence")).toBeNull();
  });
});
