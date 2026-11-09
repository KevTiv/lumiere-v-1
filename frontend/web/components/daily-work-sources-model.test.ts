import assert from "node:assert/strict";
import { test } from "node:test";
import {
  crmFollowupRows,
  dueReportScheduleRows,
  subscriptionBillingRows,
} from "./daily-work-sources-model";

const scope = { organizationId: 7n, companyId: 8n, identity: "aa" };
const company = { organization_id: "7", company_id: "8" };
const timestamp = { microsSinceUnixEpoch: "1770000000000000" };

test("CRM follows personal open activities only when the exact target is visible", () => {
  const activity = {
    organizationId: "7",
    state: "planned",
    isDone: false,
    assignedTo: "0xaa",
    userId: "bb",
    resModel: "opportunity",
    resId: "90",
    dateDeadline: timestamp,
    summary: "Call customer",
  };
  const rows = crmFollowupRows(
    [
      { ...activity, id: 1 },
      { ...activity, id: 2, assignedTo: "bb", userId: "aa" },
      { ...activity, id: 3, resId: "91" },
      { ...activity, id: 4, resModel: "contact" },
      { ...activity, id: 5, isDone: true },
      { ...activity, id: 6, resModel: "sale_order" },
      {
        ...activity,
        id: 7,
        assignedTo: null,
        userId: "aa",
        resModel: "lead",
        resId: "20",
        dateDeadline: null,
      },
      { ...activity, id: 8, organizationId: "9" },
      { ...activity, id: 9, deletedAt: timestamp },
      { ...activity, id: 10, state: undefined },
    ],
    {
      lead: [{ organizationId: "7", id: "20" }],
      opportunity: [
        { ...company, id: "90" },
        { ...company, company_id: "9", id: "91" },
      ],
      contact: [{ ...company, organization_id: "9", id: "90" }],
    },
    scope,
  );
  assert.deepEqual(
    rows.map(({ id, owner, href, due }) => [id, owner, href, due?.getTime()]),
    [
      [
        "1",
        "assignedToYou",
        "/crm?tab=activities&filter=id%3A1",
        1770000000000,
      ],
      ["7", "createdByYou", "/crm?tab=activities&filter=id%3A7", undefined],
    ],
  );
});

test("billing joins company collection rows to subscription IDs and their next billing dates", () => {
  const rows = subscriptionBillingRows(
    [
      { ...company, id: "40", subscription_id: "90", due_to_bill: true },
      { ...company, id: "41", subscription_id: "91", due_to_bill: true },
      { ...company, id: "42", subscription_id: "92", due_to_bill: false },
      {
        ...company,
        id: "43",
        subscription_id: "93",
        due_to_bill: true,
        company_id: "9",
      },
      { ...company, id: "44", subscription_id: "94" },
    ],
    [
      { ...company, id: "90", code: "SUB-90", recurring_next_date: timestamp },
      { ...company, id: "91", company_id: "9" },
      { ...company, id: "92" },
      { ...company, id: "93" },
      { ...company, id: "94" },
    ],
    scope,
  );
  assert.deepEqual(rows, [
    {
      id: "40",
      name: "SUB-90",
      href: "/subscriptions/90?tab=billing",
      due: new Date(1770000000000),
      owner: "companyQueue",
    },
  ]);
});

test("only active schedules due in the selected company get a schedule-record link", () => {
  const schedule = { ...company, is_active: true, next_run: timestamp };
  const rows = dueReportScheduleRows(
    [
      { ...schedule, id: "9007199254740993", name: "Daily sales" },
      {
        ...schedule,
        id: "1",
        next_run: { microsSinceUnixEpoch: "1770000001000000" },
      },
      { ...schedule, id: "2", is_active: false },
      { ...schedule, id: "3", company_id: "9" },
      { ...schedule, id: "4", organization_id: "9" },
      { ...schedule, id: "5", company_id: null },
      { ...schedule, id: "6", next_run: "not a date" },
      { ...schedule, id: "7", next_run: "999999999999999999999999" },
    ],
    scope,
    1770000000000,
  );
  assert.deepEqual(
    rows.map(({ id, href, owner }) => [id, href, owner]),
    [
      [
        "9007199254740993",
        "/reports?tab=scheduled-reports&filter=id%3A9007199254740993",
        "reportingQueue",
      ],
    ],
  );
});
