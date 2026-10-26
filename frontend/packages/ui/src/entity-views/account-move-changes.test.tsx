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
  RecordChangeHistory: (props: RecordChangeHistoryProps) => (
    <div data-testid="history-state" data-state={props.state}>
      {props.entries
        .map((entry) => entry.changes.map((change) => change.after))
        .join(",")}
    </div>
  ),
}));

import { AccountMoveHistoryReadError } from "@lumiere/query-hooks/hooks/account-move-history";
import { AccountMoveChanges } from "./account-move-changes";

afterEach(cleanup);
beforeEach(() => {
  control.reads.mockClear();
  Object.assign(control.session, {
    identity: "ab".repeat(32),
    organizationId: 7,
    activeCompanyId: 11,
    activeCompanyReady: true,
  });
  control.ready = true;
  control.historyAllowed = true;
  control.query.isPending = false;
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
