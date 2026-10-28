"use client";

import { useTranslation } from "@lumiere/i18n";
import type { AccountMoveHistoryEntry } from "@lumiere/query-hooks/hooks/account-move-history-model";
import { Button } from "../components/button";
import { cn } from "../lib/utils";

export type RecordChangeHistoryState = "loading" | "denied" | "error" | "ready";

export interface RecordChangeHistoryProps {
  state: RecordChangeHistoryState;
  entries: readonly AccountMoveHistoryEntry[];
  hasMore?: boolean;
  loadingMore?: boolean;
  isRefreshing?: boolean;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  className?: string;
}

/** Only render authorized server-projected deltas, never differences inferred from a current record. */
export function RecordChangeHistory({
  state,
  entries,
  hasMore,
  loadingMore = false,
  isRefreshing = false,
  onLoadMore,
  onRefresh,
  className,
}: RecordChangeHistoryProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  const fieldList = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  });
  const readPending = isRefreshing || loadingMore;
  const fieldLabels: { [key: string]: string } = {
    name: t("recordChanges.fields.name"),
    debit: t("recordChanges.fields.debit"),
    credit: t("recordChanges.fields.credit"),
    partner_id: t("recordChanges.fields.partner"),
    analytic_account_id: t("recordChanges.fields.analyticAccount"),
    balance: t("recordChanges.fields.balance"),
    amount_currency: t("recordChanges.fields.amountCurrency"),
    amount_residual: t("recordChanges.fields.residual"),
    amount_residual_currency: t("recordChanges.fields.residualCurrency"),
    debit_currency: t("recordChanges.fields.debitCurrency"),
    credit_currency: t("recordChanges.fields.creditCurrency"),
  };

  if (state === "loading") {
    return (
      <p role="status" data-testid="record-changes-loading">
        {t("recordChanges.loading")}
      </p>
    );
  }
  if (state === "denied") {
    return (
      <p role="status" data-testid="record-changes-denied">
        {t("recordChanges.denied")}
      </p>
    );
  }
  if (state === "error") {
    return (
      <div
        role="alert"
        aria-busy={readPending}
        className="min-w-0 space-y-3"
        data-testid="record-changes-error"
      >
        <p>{t("recordChanges.error")}</p>
        {onRefresh && (
          <Button
            variant="outline"
            className="h-auto max-w-full whitespace-normal py-1.5"
            disabled={readPending}
            onClick={onRefresh}
          >
            {isRefreshing
              ? t("recordChanges.refreshing")
              : t("recordChanges.retry")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <section
      className={cn("min-w-0 space-y-4", className)}
      aria-label={t("recordChanges.title")}
      aria-busy={readPending}
      data-testid="record-changes"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div
          className="min-w-0 max-w-prose space-y-1 text-sm text-muted-foreground"
          data-testid="record-changes-coverage"
        >
          <p>{t("recordChanges.coverageLead")}</p>
          <details className="min-w-0">
            <summary className="w-fit max-w-full cursor-pointer rounded-sm text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t("recordChanges.coverageDetails")}
            </summary>
            <p className="mt-2 break-words">{t("recordChanges.partialCoverage")}</p>
          </details>
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            className="h-auto max-w-full whitespace-normal py-1.5"
            disabled={readPending}
            onClick={onRefresh}
          >
            {isRefreshing
              ? t("recordChanges.refreshing")
              : t("recordChanges.refresh")}
          </Button>
        )}
      </div>
      {readPending && (
        <p role="status" className="sr-only">
          {loadingMore
            ? t("recordChanges.loadingMore")
            : t("recordChanges.refreshing")}
        </p>
      )}
      {entries.length === 0 ? (
        <p role="status" data-testid="record-changes-empty">
          {hasMore ? t("recordChanges.emptyPage") : t("recordChanges.empty")}
        </p>
      ) : (
        <ol className="min-w-0 divide-y divide-border rounded-lg border border-border bg-card">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="min-w-0"
              data-testid={`record-change-${entry.id}`}
            >
              <details className="min-w-0">
                <summary className="min-w-0 cursor-pointer space-y-1 rounded-lg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span
                    className="block break-words font-medium"
                    data-testid="record-change-summary"
                  >
                    {t("recordChanges.fieldsChanged", {
                      fields: fieldList.format(
                        entry.changes.map(
                          (change) => fieldLabels[change.field] ?? change.field,
                        ),
                      ),
                    })}
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="min-w-0 break-all">
                      {t("recordChanges.lineReference", {
                        id: entry.changedRecordId,
                      })}
                    </span>
                    <time dateTime={entry.occurredAt} className="break-words">
                      {new Date(entry.occurredAt).toLocaleString(locale, {
                        timeZoneName: "short",
                      })}
                    </time>
                    <span className="min-w-0 break-all" title={entry.actorIdentity}>
                      {t("recordChanges.user", {
                        identity: `${entry.actorIdentity.slice(0, 8)}…${entry.actorIdentity.slice(-6)}`,
                      })}
                    </span>
                  </span>
                </summary>
                <div className="min-w-0 border-t border-border px-4 pb-3">
                  <dl className="min-w-0 divide-y divide-border">
                    {entry.changes.map((change) => (
                      <div key={change.field} className="min-w-0 space-y-2 py-3">
                        <dt className="break-words text-sm font-medium">
                          {fieldLabels[change.field] ?? change.field}
                        </dt>
                        <dd className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                          <div className="min-w-0 space-y-1">
                            <span className="block text-xs text-muted-foreground">
                              {t("recordChanges.beforeThisSave")}
                            </span>
                            <span
                              className="block whitespace-pre-wrap break-all text-sm tabular-nums text-muted-foreground"
                              data-testid="record-change-before"
                            >
                              {change.before === ""
                                ? t("recordChanges.emptyText")
                                : (change.before ?? t("recordChanges.noValue"))}
                            </span>
                          </div>
                          <div className="min-w-0 space-y-1 sm:border-l sm:border-border sm:pl-3">
                            <span className="block text-xs text-muted-foreground">
                              {t("recordChanges.afterThisSave")}
                            </span>
                            <span
                              className="block whitespace-pre-wrap break-all text-sm tabular-nums"
                              data-testid="record-change-after"
                            >
                              {change.after === ""
                                ? t("recordChanges.emptyText")
                                : (change.after ?? t("recordChanges.noValue"))}
                            </span>
                          </div>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <details className="min-w-0 border-t border-border pt-3 text-xs text-muted-foreground">
                    <summary className="w-fit max-w-full cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {t("recordChanges.userIdentity")}
                    </summary>
                    <code className="mt-2 block whitespace-pre-wrap break-all">
                      {entry.actorIdentity}
                    </code>
                  </details>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {hasMore && onLoadMore && (
        <Button
          variant="outline"
          className="h-auto max-w-full whitespace-normal py-1.5"
          disabled={readPending}
          onClick={onLoadMore}
          data-testid="record-changes-more"
        >
          {loadingMore
            ? t("recordChanges.loadingMore")
            : t("recordChanges.loadMore")}
        </Button>
      )}
    </section>
  );
}
