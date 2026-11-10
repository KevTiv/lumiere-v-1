"use client";

import { useId } from "react";
import { moduleTabHref } from "@lumiere/erp-shared/record-links";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useErpSession } from "@lumiere/erp-session";
import { useTranslation } from "@lumiere/i18n";
import { fetchQueryList } from "@lumiere/query-hooks/http";
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company";
import { useRBAC } from "@lumiere/ui/lib/rbac-context";
import {
  mergeModuleStates,
  moduleQueryState,
  type ModuleDataState,
} from "@lumiere/ui/lib/module-data-state";
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice";
import {
  crmFollowupRows,
  dueReportScheduleRows,
  subscriptionBillingRows,
  type DailyWorkPreviewRow,
  type DailyWorkScope,
} from "./daily-work-sources-model";

type SourceScope = DailyWorkScope & { authorizationKey: string };
type SourceResource =
  | "activities"
  | "leads"
  | "opportunities"
  | "contacts"
  | "subscription-due-to-bill"
  | "subscriptions"
  | "scheduled-reports";

function useDailyWorkRows(
  resource: SourceResource,
  scope: SourceScope,
  enabled = true,
) {
  // Use the native BFF list readers with a company and actor cache key. The
  // module-wide caches can also contain rows loaded for a different company.
  const query = useQuery({
    queryKey: [
      "daily-work",
      resource,
      String(scope.organizationId),
      String(scope.companyId),
      scope.identity,
      scope.authorizationKey,
    ],
    queryFn: () =>
      fetchQueryList(
        `/api/query/${resource}?companyId=${scope.companyId}&organizationId=${scope.organizationId}`,
        "Could not load daily work records",
      ),
    enabled,
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });
  const queryState = moduleQueryState({ ...query, isLoading: query.isPending });
  const state: ModuleDataState =
    queryState.status === "partial"
      ? { status: "error", onRetry: queryState.onRetry }
      : queryState;
  return {
    state,
    rows: enabled && state.status === "ready" ? (query.data ?? []) : [],
    updatedAt: query.dataUpdatedAt,
    retry: () => {
      void query.refetch();
    },
  };
}

const sourceDetails = {
  crm: {
    title: "workspace.dailyWork.crmWork",
    href: moduleTabHref("crm", "my-activities"),
  },
  billing: {
    title: "workspace.dailyWork.subscriptionBilling",
    href: "/subscriptions?tab=due-to-bill",
  },
  schedules: {
    title: "workspace.dailyWork.reportSchedules",
    href: "/reports?tab=scheduled-reports",
  },
} as const;

type Source = keyof typeof sourceDetails;
type SourceProps = { scope: SourceScope; limit: number };

function SourcePreview({
  source,
  state,
  rows,
  limit,
}: {
  source: Source;
  state: ModuleDataState;
  rows: DailyWorkPreviewRow[];
  limit: number;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const detail = sourceDetails[source];
  const shown = rows.slice(0, limit);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    ...(source === "schedules" ? { timeStyle: "short" } : {}),
  });
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 border-t py-4"
      data-testid={`daily-work-${source}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h3 id={headingId} className="text-base font-semibold">
            {t(detail.title)}
          </h3>
          {shown.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("workspace.dailyWork.loadedPreview", {
                shown: shown.length,
                loaded: rows.length,
              })}
            </p>
          )}
        </div>
        {state.status !== "denied" && (
          <Link
            href={detail.href}
            className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(`workspace.dailyWork.openSource.${source}`)}
          </Link>
        )}
      </header>
      {state.status !== "ready" && (
        <div className="mt-3 text-sm">
          {state.status === "loading" ? (
            <p role="status" className="text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : (
            <ModuleDataNotice state={state} />
          )}
        </div>
      )}
      {state.status === "ready" && shown.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(`workspace.dailyWork.sourceEmpty.${source}`)}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-2 divide-y">
          {shown.map((row) => (
            <li
              key={row.id}
              className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0 space-y-1">
                <p className="break-words text-sm font-medium">
                  {row.name ??
                    t("workspace.dailyWork.recordNumber", { id: row.id })}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t(`workspace.dailyWork.sourceReason.${source}`)}</span>
                  <span>
                    {t(`workspace.dailyWork.sourceOwner.${row.owner}`)}
                  </span>
                  <span>
                    {row.due
                      ? t("workspace.dailyWork.dueOn", {
                          date: dateFormat.format(row.due),
                        })
                      : t("workspace.dailyWork.deadlineUnavailable")}
                  </span>
                </p>
              </div>
              <Link
                href={row.href}
                aria-label={t(`workspace.dailyWork.reviewRecord.${source}`, {
                  record: row.name ?? `#${row.id}`,
                })}
                className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(`workspace.dailyWork.reviewSource.${source}`)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CrmPreview({
  scope,
  limit,
  targets,
}: SourceProps & {
  targets: { lead: boolean; opportunity: boolean; contact: boolean };
}) {
  const { t } = useTranslation();
  const activities = useDailyWorkRows("activities", scope);
  const leads = useDailyWorkRows("leads", scope, targets.lead);
  const opportunities = useDailyWorkRows(
    "opportunities",
    scope,
    targets.opportunity,
  );
  const contacts = useDailyWorkRows("contacts", scope, targets.contact);
  const activeTargets = [
    ...(targets.lead ? [leads] : []),
    ...(targets.opportunity ? [opportunities] : []),
    ...(targets.contact ? [contacts] : []),
  ];
  const incomplete = activeTargets.filter(
    ({ state }) => state.status === "denied" || state.status === "error",
  );
  const retriable = incomplete.filter(({ state }) => state.status === "error");
  const state: ModuleDataState =
    activities.state.status !== "ready"
      ? activities.state
      : incomplete.length
        ? {
            status: "partial",
            message: t("workspace.dailyWork.crmPartial"),
            onRetry: retriable.length
              ? () => retriable.forEach(({ retry }) => retry())
              : undefined,
          }
        : mergeModuleStates(activeTargets.map(({ state }) => state));
  const rows =
    state.status === "ready" || state.status === "partial"
      ? crmFollowupRows(
          activities.rows,
          {
            lead: leads.rows,
            opportunity: opportunities.rows,
            contact: contacts.rows,
          },
          scope,
        )
      : [];
  return <SourcePreview source="crm" state={state} limit={limit} rows={rows} />;
}

function BillingPreview({ scope, limit }: SourceProps) {
  const queue = useDailyWorkRows("subscription-due-to-bill", scope);
  const subscriptions = useDailyWorkRows("subscriptions", scope);
  const state = mergeModuleStates([queue.state, subscriptions.state]);
  const rows =
    state.status === "ready"
      ? subscriptionBillingRows(queue.rows, subscriptions.rows, scope)
      : [];
  return (
    <SourcePreview source="billing" state={state} limit={limit} rows={rows} />
  );
}

function SchedulePreview({ scope, limit }: SourceProps) {
  const schedules = useDailyWorkRows("scheduled-reports", scope);
  const scopeUnavailable = schedules.rows.some(
    (row) => !("companyId" in row || "company_id" in row),
  );
  const state: ModuleDataState = scopeUnavailable
    ? { status: "error", onRetry: schedules.retry }
    : schedules.state;
  const rows =
    state.status === "ready"
      ? dueReportScheduleRows(schedules.rows, scope, schedules.updatedAt)
      : [];
  return (
    <SourcePreview source="schedules" state={state} limit={limit} rows={rows} />
  );
}

export function DailyWorkSources({
  organizationId,
  summary,
}: {
  organizationId: number;
  summary: boolean;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const session = useErpSession();
  const companyId = useOperatingCompanyBigInt(organizationId);
  const { currentUser, roles, policies, permissionsReady, checkPermission } =
    useRBAC();
  if (
    permissionsReady === false ||
    !currentUser ||
    !session.identity ||
    session.organizationId !== organizationId
  )
    return null;

  const canOpen = (module: string) =>
    checkPermission(`module:${module}`, "read").allowed;
  const canReadSource = (resources: readonly string[]) =>
    resources.every(
      (resource) => checkPermission(resource, "read").rule?.effect !== "deny",
    );
  const targets = {
    lead: canReadSource(["lead", "leads"]),
    opportunity: canReadSource(["opportunity", "opportunities"]),
    contact: canReadSource(["contact", "contacts"]),
  };
  const crm =
    canOpen("crm") &&
    canReadSource(["activity", "activities"]) &&
    Object.values(targets).some(Boolean);
  const billing =
    canOpen("subscriptions") &&
    canReadSource([
      "subscription-due-to-bill",
      "subscription_collection",
      "subscription",
      "subscriptions",
    ]);
  const schedules =
    canOpen("reports") &&
    canReadSource(["scheduled_report", "scheduled-reports"]);
  if (!crm && !billing && !schedules) return null;
  const scope =
    session.activeCompanyReady !== false && companyId
      ? {
          organizationId: BigInt(organizationId),
          companyId,
          identity: session.identity,
          authorizationKey: JSON.stringify({ currentUser, roles, policies }),
        }
      : null;
  const limit = summary ? 3 : 5;
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 pt-2"
      data-testid="daily-work-sources"
    >
      <h2 id={headingId} className="mb-3 text-lg font-semibold">
        {t("workspace.dailyWork.sourceTitle")}
      </h2>
      {scope ? (
        <>
          {crm && <CrmPreview scope={scope} limit={limit} targets={targets} />}
          {billing && <BillingPreview scope={scope} limit={limit} />}
          {schedules && <SchedulePreview scope={scope} limit={limit} />}
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t("financeReview.selectCompany")}
        </p>
      )}
    </section>
  );
}
