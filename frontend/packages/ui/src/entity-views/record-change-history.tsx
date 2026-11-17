"use client";

import { useTranslation } from "@lumiere/i18n";
import type { BusinessHistoryCoverage, BusinessHistoryEntry } from "@lumiere/query-hooks/hooks/business-history-model";
import type { ReactNode } from "react";
import { Button } from "../components/button";
import { cn } from "../lib/utils";
import { HistoryFieldDiff } from "./history-field-diff";

export type RecordChangeHistoryState = "loading" | "denied" | "error" | "ready";

export interface RecordChangeHistoryProps {
  state: RecordChangeHistoryState;
  entries: readonly BusinessHistoryEntry[];
  variant?: "accounting" | "record" | "activity";
  coverage?: BusinessHistoryCoverage;
  renderRecordLink?: (entry: BusinessHistoryEntry) => ReactNode;
  renderEventLink?: (entry: BusinessHistoryEntry) => ReactNode;
  selectedEventId?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  isRefreshing?: boolean;
  onLoadMore?: () => void;
  onRefresh?: () => void;
  className?: string;
}

function openSelectedEvent(details: HTMLDetailsElement | null) {
  if (!details) return;
  details.open = true;
  details.querySelector("summary")?.focus();
}

/** Only render authorized server-projected deltas, never differences inferred from a current record. */
export function RecordChangeHistory({
  state,
  entries,
  variant = "accounting",
  coverage,
  renderRecordLink,
  renderEventLink,
  selectedEventId,
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
    name: variant === "accounting" ? t("recordChanges.fields.name") : t("common.name", { defaultValue: "Name" }),
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
    account_id: t("recordChanges.fields.account", { defaultValue: "Account" }),
    currency_id: t("recordChanges.fields.currency", { defaultValue: "Currency" }),
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
      aria-label={variant === "accounting" ? t("recordChanges.title") : t("businessHistory.title")}
      aria-busy={readPending}
      data-testid="record-changes"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div
          className="min-w-0 max-w-prose space-y-1 text-sm text-muted-foreground"
          data-testid="record-changes-coverage"
        >
          <p>{variant === "accounting" ? t("recordChanges.coverageLead") : t("businessHistory.partial")}</p>
          <details className="min-w-0">
            <summary className="w-fit max-w-full cursor-pointer rounded-sm text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t("recordChanges.coverageDetails")}
            </summary>
            <p className="mt-2 break-words">{coverage?.message ?? (variant === "accounting" ? t("recordChanges.partialCoverage") : t("businessHistory.coverage"))}</p>
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
          {variant === "accounting" ? (hasMore ? t("recordChanges.emptyPage") : t("recordChanges.empty")) : (hasMore ? t("businessHistory.emptyPage") : t("businessHistory.empty"))}
        </p>
      ) : (
        <ol className="min-w-0 divide-y divide-border rounded-lg border border-border bg-card">
          {entries.map((entry) => (
            <li
              key={entry.id}
              id={`history-event-${variant}-${entry.id}`}
              className="min-w-0"
              data-testid={`record-change-${entry.id}`}
            >
              <details
                className="min-w-0"
                ref={entry.id === selectedEventId ? openSelectedEvent : undefined}
              >
                <summary className="min-w-0 cursor-pointer space-y-1 rounded-lg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span
                    className="block break-words font-medium"
                    data-testid="record-change-summary"
                  >
                    {entry.changes.length === 0 ? t("businessHistory.recordedOperation", { operation: entry.operation.replace(/_/g, " ") }) : t(entry.operation === "add_account_move_line" ? "recordChanges.lineAdded" : "recordChanges.fieldsChanged", {
                      ...(entry.operation === "add_account_move_line" ? { defaultValue: "Added journal item: {{fields}}" } : {}),
                      fields: fieldList.format(
                        entry.changes.map(
                          (change) => fieldLabels[change.field] ?? change.field,
                        ),
                      ),
                    })}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {entry.changes.length > 0 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
                        {t("recordChanges.savedChange", { defaultValue: "Saved change" })}
                      </span>
                    )}
                    <span className="min-w-0 break-all">
                      {variant === "accounting" ? t("recordChanges.lineReference", { id: entry.changedRecordId }) : t("businessHistory.recordReference", { resource: entry.changedResource.replace(/[-_]/g, " "), id: entry.changedRecordId })}
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
                <div className="min-w-0 space-y-3 border-t border-border px-3 py-3">
                  {entry.changes.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("businessHistory.noComparisons")}</p>
                  )}
                  {renderRecordLink?.(entry)}
                  <HistoryFieldDiff
                    fields={entry.changes.map((change) => ({
                      id: change.field,
                      label: fieldLabels[change.field] ?? change.field,
                      before:
                        entry.operation === "add_account_move_line"
                          ? { kind: "absent" }
                          : { kind: "value", value: change.before },
                      after: { kind: "value", value: change.after },
                    }))}
                    valueTestIdPrefix="record-change"
                  />
                  {renderEventLink?.(entry)}
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
