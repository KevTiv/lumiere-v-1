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
  onLoadMore?: () => void;
  onRefresh?: () => void;
  className?: string;
}

/** Only render authorized server-projected deltas, never differences inferred from a current record. */
export function RecordChangeHistory({
  state,
  entries,
  hasMore,
  loadingMore,
  onLoadMore,
  onRefresh,
  className,
}: RecordChangeHistoryProps) {
  const { t } = useTranslation();
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

  if (state === "loading")
    return (
      <p role="status" data-testid="record-changes-loading">
        {t("recordChanges.loading")}
      </p>
    );
  if (state === "denied")
    return (
      <p role="status" data-testid="record-changes-denied">
        {t("recordChanges.denied")}
      </p>
    );
  if (state === "error")
    return (
      <div
        role="alert"
        className="space-y-3"
        data-testid="record-changes-error"
      >
        <p>{t("recordChanges.error")}</p>
        {onRefresh ? (
          <Button variant="outline" onClick={onRefresh}>
            {t("recordChanges.retry")}
          </Button>
        ) : null}
      </div>
    );

  return (
    <section
      className={cn("min-w-0 space-y-4", className)}
      aria-label={t("recordChanges.title")}
      data-testid="record-changes"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p
          className="max-w-prose text-sm text-muted-foreground"
          data-testid="record-changes-coverage"
        >
          {t("recordChanges.partialCoverage")}
        </p>
        {onRefresh ? (
          <Button variant="outline" size="sm" onClick={onRefresh}>
            {t("recordChanges.refresh")}
          </Button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p role="status" data-testid="record-changes-empty">
          {hasMore ? t("recordChanges.emptyPage") : t("recordChanges.empty")}
        </p>
      ) : (
        <ol className="min-w-0 space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="min-w-0 rounded-lg border border-border bg-card"
              data-testid={`record-change-${entry.id}`}
            >
              <details>
                <summary className="cursor-pointer space-y-1 rounded-lg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span className="block font-medium">
                    {t("recordChanges.lineUpdated", {
                      id: entry.changedRecordId,
                    })}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString()}
                    </time>
                    {" · "}
                    <span title={entry.actorIdentity}>
                      {t("recordChanges.by", {
                        actor: `${entry.actorIdentity.slice(0, 8)}…${entry.actorIdentity.slice(-6)}`,
                      })}
                    </span>
                  </span>
                </summary>
                <dl className="min-w-0 divide-y border-t border-border px-4">
                  {entry.changes.map((change) => (
                    <div key={change.field} className="min-w-0 space-y-2 py-3">
                      <dt className="text-sm font-medium">
                        {fieldLabels[change.field] ??
                          change.field.replaceAll("_", " ")}
                      </dt>
                      <dd className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="min-w-0 rounded-md bg-muted/50 p-3">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t("recordChanges.before")}
                          </span>
                          <span
                            className="block whitespace-pre-wrap break-all text-sm tabular-nums"
                            data-testid="record-change-before"
                          >
                            {change.before ?? t("recordChanges.noValue")}
                          </span>
                        </div>
                        <div className="min-w-0 rounded-md border border-border p-3">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t("recordChanges.after")}
                          </span>
                          <span
                            className="block whitespace-pre-wrap break-all text-sm tabular-nums"
                            data-testid="record-change-after"
                          >
                            {change.after ?? t("recordChanges.noValue")}
                          </span>
                        </div>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ol>
      )}
      {hasMore && onLoadMore ? (
        <Button
          variant="outline"
          disabled={loadingMore}
          onClick={onLoadMore}
          data-testid="record-changes-more"
        >
          {loadingMore
            ? t("recordChanges.loading")
            : t("recordChanges.loadMore")}
        </Button>
      ) : null}
    </section>
  );
}
