import { moduleTabHref } from "@lumiere/erp-shared/record-links";
import { stbTimestampMicros } from "@lumiere/erp-shared/stb-timestamp";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import { entityScalarText } from "@lumiere/ui/lib/entity-row-values";
import { kpiDate } from "@lumiere/ui/lib/kpi-tiles";
import {
  crmActivityTarget,
  type CrmRecordKind,
  type CrmWorkRecord,
} from "../app/(modules)/crm/crm-workflow";
import {
  deadlineMs,
  identityKey,
  myOpenActivities,
} from "../app/(modules)/crm/my-activities";
import {
  scopedReports,
  type ReportRow,
} from "../app/(modules)/reports/report-workspace-model";
import {
  inSubscriptionScope,
  subscriptionQueueHref,
  type WorkflowRow,
} from "../app/(modules)/subscriptions/subscription-workflow";

type ScopedRecord = Pick<
  WorkflowRow,
  "id" | "organizationId" | "organization_id" | "companyId" | "company_id"
>;
type CrmActivityRow = CrmWorkRecord & ScopedRecord;

interface SubscriptionBillingQueueRow extends ScopedRecord {
  subscriptionId?: WorkflowRow["subscriptionId"];
  subscription_id?: WorkflowRow["subscription_id"];
  dueToBill?: unknown;
  due_to_bill?: unknown;
}

interface ReportScheduleRow extends ReportRow {
  isActive?: unknown;
  is_active?: unknown;
  nextRun?: unknown;
  next_run?: unknown;
}
export type DailyWorkScope = {
  organizationId: bigint;
  companyId: bigint;
  identity: string;
};

export interface DailyWorkPreviewRow {
  id: string;
  name: string | null;
  href: string;
  due: Date | null;
  owner: "assignedToYou" | "createdByYou" | "companyQueue" | "reportingQueue";
}

function rowId(row: Pick<ScopedRecord, "id">): string | undefined {
  return (parseStrictU64(row.id) || undefined)?.toString();
}

function inOrganization(row: ScopedRecord, scope: DailyWorkScope): boolean {
  return (
    parseStrictU64(row.organizationId ?? row.organization_id) ===
    scope.organizationId
  );
}

export function crmFollowupRows(
  activities: readonly CrmActivityRow[],
  targets: Readonly<Record<CrmRecordKind, readonly ScopedRecord[]>>,
  scope: DailyWorkScope,
): DailyWorkPreviewRow[] {
  const visible = (kind: CrmRecordKind) =>
    new Set(
      targets[kind]
        .filter(
          (row) =>
            inOrganization(row, scope) &&
            (kind === "lead" ||
              parseStrictU64(row.companyId ?? row.company_id) ===
                scope.companyId),
        )
        .map(rowId),
    );
  const visibleIds = {
    lead: visible("lead"),
    opportunity: visible("opportunity"),
    contact: visible("contact"),
  };

  // The activity table is organization-scoped. Verify each target before surfacing
  // the activity. Leads are organization-owned; contacts and deals are company-owned.
  return myOpenActivities(
    activities.filter(
      (row) =>
        inOrganization(row, scope) &&
        ("assignedTo" in row || "assigned_to" in row) &&
        typeof (row.isDone ?? row.is_done) === "boolean" &&
        typeof row.state === "string",
    ),
    scope.identity,
  ).flatMap((row) => {
    const target = crmActivityTarget(row);
    const id = rowId(row);
    if (!target || !id || !visibleIds[target.kind].has(target.id)) return [];
    const rawDue = row.dateDeadline ?? row.date_deadline;
    const due = deadlineMs(rawDue);
    const date = due == null ? workDate(rawDue) : new Date(due);
    return [
      {
        id,
        name: entityScalarText(row.summary),
        href: moduleTabHref("crm", "activities", { id }, "my-activities"),
        due: date && Number.isFinite(date.getTime()) ? date : null,
        owner: identityKey(row.assignedTo ?? row.assigned_to)
          ? "assignedToYou"
          : "createdByYou",
      },
    ];
  });
}

export function subscriptionBillingRows(
  queue: readonly SubscriptionBillingQueueRow[],
  subscriptions: readonly WorkflowRow[],
  scope: DailyWorkScope,
): DailyWorkPreviewRow[] {
  const byId = new Map(
    subscriptions
      .filter((row) => inSubscriptionScope(row, scope))
      .map((row) => [rowId(row), row]),
  );
  const visibleIds = new Set(
    [...byId.keys()].filter((id): id is string => id != null),
  );
  return queue
    .flatMap((row): DailyWorkPreviewRow[] => {
      if ((row.dueToBill ?? row.due_to_bill) !== true) return [];
      const href = subscriptionQueueHref(row, scope, visibleIds, "billing");
      const id = rowId(row);
      const subscription = byId.get(
        parseStrictU64(row.subscriptionId ?? row.subscription_id)?.toString(),
      );
      if (!id || !href || !subscription) return [];
      return [
        {
          id,
          name:
            entityScalarText(subscription.code) ?? `#${rowId(subscription)}`,
          href,
          due: workDate(
            subscription.recurringNextDate ?? subscription.recurring_next_date,
          ),
          owner: "companyQueue",
        },
      ];
    })
    .sort(byDue);
}

export function dueReportScheduleRows(
  schedules: readonly ReportScheduleRow[],
  scope: DailyWorkScope,
  now: number,
): DailyWorkPreviewRow[] {
  return scopedReports(schedules, scope.organizationId, scope.companyId)
    .flatMap((row): DailyWorkPreviewRow[] => {
      const id = rowId(row);
      const due = workDate(row.nextRun ?? row.next_run);
      if (
        !id ||
        (row.isActive ?? row.is_active) !== true ||
        !due ||
        due.getTime() > now
      )
        return [];
      return [
        {
          id,
          name: entityScalarText(row.name),
          href: moduleTabHref("reports", "scheduled-reports", { id }),
          due,
          owner: "reportingQueue",
        },
      ];
    })
    .sort(byDue);
}

function workDate(value: unknown): Date | null {
  const micros = stbTimestampMicros(value);
  const date =
    micros == null ? kpiDate(value) : new Date(Number(micros / 1000n));
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function byDue(a: DailyWorkPreviewRow, b: DailyWorkPreviewRow): number {
  return (
    (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) ||
    a.id.localeCompare(b.id)
  );
}
