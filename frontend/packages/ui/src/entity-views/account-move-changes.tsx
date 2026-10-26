"use client";

import { useErpSession } from "@lumiere/erp-session";
import {
  useAccountMoveHistory,
  AccountMoveHistoryReadError,
} from "@lumiere/query-hooks/hooks/account-move-history";
import { mergeAccountMoveHistoryPages } from "@lumiere/query-hooks/hooks/account-move-history-model";
import { useRBAC } from "../lib/rbac-context";
import {
  RecordChangeHistory,
  type RecordChangeHistoryState,
} from "./record-change-history";

export interface AccountMoveChangesProps {
  organizationId: number;
  companyId: string | number | bigint;
  recordId: string;
}

/** Scope and authority changes hide prior content before another history read can complete. */
export function AccountMoveChanges({
  organizationId,
  companyId,
  recordId,
}: AccountMoveChangesProps) {
  const session = useErpSession();
  const { currentUser, roles, policies, permissionsReady, checkPermission } =
    useRBAC();
  const ready =
    permissionsReady !== false &&
    session.activeCompanyReady !== false &&
    session.organizationId === organizationId &&
    !!session.identity &&
    !!currentUser;
  // The record host can resolve an authorized default before a global selection exists.
  // An explicit different selection still hides the old record immediately.
  const sameCompany =
    session.activeCompanyId == null ||
    String(session.activeCompanyId) === String(companyId);
  // Source-read policies support module grants and field-level rules on the server.
  // The local checker cannot reproduce those semantics; it only gates this explicit capability.
  const allowed =
    ready && sameCompany && checkPermission("business_history", "read").allowed;
  const scope = {
    organizationId,
    companyId: String(companyId),
    recordId,
    actorIdentity: session.identity ?? "",
    authorizationKey: JSON.stringify({ currentUser, roles, policies }),
  };
  const query = useAccountMoveHistory(scope, allowed);
  let state: RecordChangeHistoryState = !ready
    ? "loading"
    : !allowed
      ? "denied"
      : query.isPending
        ? "loading"
        : query.isError
          ? "error"
          : "ready";
  if (
    allowed &&
    query.error instanceof AccountMoveHistoryReadError &&
    [401, 403, 404].includes(query.error.status)
  )
    state = "denied";
  let entries: ReturnType<typeof mergeAccountMoveHistoryPages> = [];
  if (state === "ready") {
    try {
      entries = mergeAccountMoveHistoryPages(query.data?.pages ?? []);
    } catch {
      state = "error";
    }
  }
  return (
    <RecordChangeHistory
      state={state}
      entries={entries}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => {
        void query.fetchNextPage();
      }}
      onRefresh={
        allowed
          ? () => {
              void query.refetch();
            }
          : undefined
      }
    />
  );
}
