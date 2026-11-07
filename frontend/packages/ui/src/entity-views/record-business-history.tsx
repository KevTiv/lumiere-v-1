"use client";

import { useErpSession } from "@lumiere/erp-session";
import { useTranslation } from "@lumiere/i18n";
import { useOperatingCompanyId } from "@lumiere/query-hooks/hooks/use-operating-company";
import {
  BusinessHistoryReadError, useBusinessHistory, useBusinessHistoryActivity, useBusinessHistorySources,
} from "@lumiere/query-hooks/hooks/business-history";
import {
  businessHistoryActivityScopeReady, businessHistoryScopeReady, canonicalBusinessHistoryResource, mergeBusinessHistoryPages,
  type BusinessHistoryEntry, type BusinessHistorySource,
} from "@lumiere/query-hooks/hooks/business-history-model";
import { validHistoryId } from "@lumiere/query-hooks/hooks/account-move-history-model";
import { sourceReviewHistoryHref } from "@lumiere/query-hooks/hooks/source-review-navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/button";
import { useRBAC } from "../lib/rbac-context";
import { RecordChangeHistory, type RecordChangeHistoryState } from "./record-change-history";

export interface RecordBusinessHistoryProps {
  tableName: string;
  recordId: string | number | bigint;
  companyId?: string | number | bigint;
  className?: string;
}

function exactId(value: string | number | bigint | null | undefined): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  const id = value == null ? "" : String(value);
  return validHistoryId(id) ? id : "";
}

/** Resolve company scope through the existing operating-company owner. */
function useHistoryAuthority(companyId?: string | number | bigint) {
  const session = useErpSession();
  const operatingCompanyId = useOperatingCompanyId(session.organizationId);
  const company = exactId(companyId ?? operatingCompanyId);
  const { currentUser, roles, policies, permissionsReady, checkPermission } = useRBAC();
  const ready = permissionsReady !== false && session.activeCompanyReady !== false
    && !!session.identity && !!session.organizationId && !!currentUser;
  const sameCompany = session.activeCompanyId == null || String(session.activeCompanyId) === company;
  const allowed = ready && sameCompany && !!company && checkPermission("business_history", "read").allowed;
  return {
    ready, allowed,
    scope: { organizationId: session.organizationId ?? 0, companyId: company,
      actorIdentity: session.identity ?? "", authorizationKey: JSON.stringify({ currentUser, roles, policies }) },
  };
}

type ReadStatus = { isPending: boolean; isError: boolean; error: unknown };
function stateFor(ready: boolean, allowed: boolean, query: ReadStatus): RecordChangeHistoryState {
  if (!ready) return "loading";
  if (!allowed) return "denied";
  if (query.isError) return query.error instanceof BusinessHistoryReadError && [401, 403, 404].includes(query.error.status) ? "denied" : "error";
  return query.isPending ? "loading" : "ready";
}

/** History reads use server scope and pagination, never an organization-wide audit download. */
export function RecordBusinessHistory({ tableName, recordId, companyId, className }: RecordBusinessHistoryProps) {
  const { t } = useTranslation();
  const authority = useHistoryAuthority(companyId);
  const scope = { ...authority.scope, resource: canonicalBusinessHistoryResource(tableName), recordId: exactId(recordId) };
  const allowed = authority.allowed && businessHistoryScopeReady(scope);
  const query = useBusinessHistory(scope, allowed);
  const sources = useBusinessHistorySources(scope, allowed);
  const scopeKey = JSON.stringify(scope);
  const denied = [query, sources].some((read) => read.isError && read.error instanceof BusinessHistoryReadError && [401, 403, 404].includes(read.error.status));
  const [revokedScope, setRevokedScope] = useState<string | null>(null);
  useEffect(() => { if (denied) setRevokedScope(scopeKey); }, [denied, scopeKey]);
  const revoked = denied || revokedScope === scopeKey;
  const refreshBoth = async () => {
    try {
      const [historyResult, sourceResult] = await Promise.all([query.refetch(), sources.refetch()]);
      if (historyResult?.status === "success" && sourceResult?.status === "success") {
        setRevokedScope((current) => current === scopeKey ? null : current);
      }
    } catch { /* Keep the learned revocation until both current reads succeed. */ }
  };
  let state = revoked ? "denied" as const : stateFor(authority.ready, allowed, query);
  let entries: BusinessHistoryEntry[] = [];
  if (state === "ready") {
    try { entries = mergeBusinessHistoryPages(query.data?.pages ?? []); }
    catch { state = "error"; }
  }
  let sourceState = revoked ? "denied" as const : stateFor(authority.ready, allowed, sources);
  let sourceEntries: BusinessHistorySource[] = [];
  if (sourceState === "ready") {
    try { sourceEntries = mergeBusinessHistoryPages(sources.data?.pages ?? []); }
    catch { sourceState = "error"; }
  }
  return <div className={className} data-testid="record-history-and-sources">
    {revoked && allowed && <Button className="mb-3" variant="outline" disabled={query.isFetching || sources.isFetching} onClick={() => { void refreshBoth(); }}>{t("businessHistory.refreshAll")}</Button>}
    <h3 className="mb-3 font-medium">{t("businessHistory.changes")}</h3>
    <RecordChangeHistory state={state} variant="record" entries={entries}
      coverage={query.data?.pages[0]?.coverage}
      hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage}
      isRefreshing={Boolean(query.isFetching && !query.isPending && !query.isFetchingNextPage)}
      onLoadMore={() => { void query.fetchNextPage(); }}
      onRefresh={allowed ? () => { void refreshBoth(); } : undefined} />
    <section className="mt-6 min-w-0 space-y-3 border-t pt-4" aria-label={t("businessHistory.sources")}>
      <h3 className="font-medium">{t("businessHistory.sources")}</h3>
      <RecordHistorySources state={sourceState} entries={sourceEntries}
        companyId={scope.companyId}
        coverage={sources.data?.pages[0]?.coverage.message}
        hasMore={sources.hasNextPage} pending={sources.isFetching}
        onLoadMore={() => { void sources.fetchNextPage(); }}
        onRefresh={allowed ? () => { void refreshBoth(); } : undefined} />
    </section>
  </div>;
}

interface RecordHistorySourcesProps {
  state: RecordChangeHistoryState;
  entries: readonly BusinessHistorySource[];
  coverage?: string;
  companyId?: string;
  hasMore?: boolean;
  pending?: boolean;
  onLoadMore?: () => void;
  onRefresh?: () => void;
}

export function RecordHistorySources({ state, entries, coverage, companyId, hasMore, pending, onLoadMore, onRefresh }: RecordHistorySourcesProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  if (state === "loading") return <p role="status">{t("businessHistory.sourcesLoading")}</p>;
  if (state === "denied") return <p role="status">{t("businessHistory.sourcesDenied")}</p>;
  if (state === "error") return <div role="alert" className="space-y-2">
    <p>{t("businessHistory.sourcesError")}</p>
    {onRefresh && <Button variant="outline" disabled={pending} onClick={onRefresh}>{t("recordChanges.retry")}</Button>}
  </div>;
  return <div className="min-w-0 space-y-3" aria-busy={pending} data-testid="record-history-sources">
    {coverage && <p className="max-w-prose text-sm text-muted-foreground">{coverage}</p>}
    {!entries.length ? <p role="status" className="text-sm text-muted-foreground">{hasMore ? t("businessHistory.sourcesEmptyPage") : t("businessHistory.sourcesEmpty")}</p> : <ol className="min-w-0 divide-y rounded-lg border">
      {entries.map((entry) => <li key={entry.id} className="min-w-0 space-y-2 p-4">
        <p className="break-words font-medium">{entry.fileName ?? t("businessHistory.fileUnavailable")}</p>
        <p className="text-sm">{t("businessHistory.importReference", { job: entry.jobId, row: entry.rowNumber })}</p>
        <p className="text-sm text-muted-foreground">{t("businessHistory.importStatus", { status: entry.status })}</p>
        <time className="block text-xs text-muted-foreground" dateTime={entry.importedAt}>{t("businessHistory.importedAt", { time: new Date(entry.importedAt).toLocaleString(locale, { timeZoneName: "short" }) })}</time>
        {entry.contentSha256 && <details className="min-w-0 text-xs text-muted-foreground"><summary className="cursor-pointer">{t("businessHistory.contentHash")}</summary><code className="mt-2 block break-all">{entry.contentSha256}</code></details>}
        {entry.sourceRelationship === "user_prepared_derivative" && entry.sourceSha256 && <div className="space-y-2 text-xs text-muted-foreground"><p>{t("businessHistory.sourceDerivative")}</p><details className="min-w-0"><summary className="cursor-pointer">{t("businessHistory.sourceHash")}</summary><code className="mt-2 block break-all">{entry.sourceSha256}</code></details></div>}
        {entry.review && companyId && validHistoryId(companyId) && <div className="space-y-1 text-sm"><p className="text-muted-foreground">{t("businessHistory.reviewReference", { item: entry.review.itemId, revision: entry.review.revision })}</p><a className="font-medium underline underline-offset-4" href={sourceReviewHistoryHref(companyId, entry.review)}>{t("businessHistory.openSourceReview")}</a></div>}
      </li>)}
    </ol>}
    <div className="flex flex-wrap gap-2">
      {hasMore && onLoadMore && <Button variant="outline" disabled={pending} onClick={onLoadMore}>{pending ? t("businessHistory.sourcesLoading") : t("businessHistory.sourcesMore")}</Button>}
      {onRefresh && <Button variant="outline" disabled={pending} onClick={onRefresh}>{t("businessHistory.sourcesRefresh")}</Button>}
    </div>
  </div>;
}

export interface ModuleBusinessHistoryProps {
  moduleId: string;
  className?: string;
  renderRecordLink?: (entry: BusinessHistoryEntry & { resource?: string; recordId?: string }) => ReactNode;
}

/** Module feeds share the exact scope/cache/error handling used by record history. */
export function ModuleBusinessHistory({ moduleId, className, renderRecordLink }: ModuleBusinessHistoryProps) {
  const authority = useHistoryAuthority();
  const scope = { ...authority.scope, module: moduleId };
  const allowed = authority.allowed && businessHistoryActivityScopeReady(scope);
  const query = useBusinessHistoryActivity(scope, allowed);
  let state = stateFor(authority.ready, allowed, query);
  let entries: BusinessHistoryEntry[] = [];
  if (state === "ready") {
    try { entries = mergeBusinessHistoryPages(query.data?.pages ?? []); }
    catch { state = "error"; }
  }
  return <RecordChangeHistory state={state} variant="activity" entries={entries}
    className={className} coverage={query.data?.pages[0]?.coverage}
    hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage}
    isRefreshing={Boolean(query.isFetching && !query.isPending && !query.isFetchingNextPage)}
    onLoadMore={() => { void query.fetchNextPage(); }}
    onRefresh={allowed ? () => { void query.refetch(); } : undefined}
    renderRecordLink={renderRecordLink} />;
}
