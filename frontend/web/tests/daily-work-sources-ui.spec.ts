import { expect, test } from "@playwright/test";

test("source previews isolate failures, company switches, and permission revocation", async ({
  page,
}) => {
  const scopeReads: string[] = [];
  const identity = "ab".repeat(32);
  const due = { microsSinceUnixEpoch: 1_770_000_000_000_000 };
  let contactsAvailable = false;

  await page.route("**/api/query/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1);
    const companyId = Number(url.searchParams.get("companyId"));
    const base = { organizationId: 7, companyId };
    if (resource === "contacts" && !contactsAvailable) {
      return route.fulfill({
        status: 503,
        json: { error: "Contact source unavailable" },
      });
    }
    const activity = {
      ...base,
      assignedTo: identity,
      isDone: false,
      state: "planned",
      dateDeadline: due,
    };
    const records: Record<string, Record<string, unknown>[]> = {
      companies: [
        { id: 11, organizationId: 7, name: "First" },
        { id: 22, organizationId: 7, name: "Second" },
      ],
      activities: [
        {
          ...activity,
          id: 10,
          resModel: "opportunity",
          resId: 11,
          summary: `Call for company ${companyId}`,
        },
        {
          ...activity,
          id: 12,
          resModel: "contact",
          resId: 13,
          summary: "Check contact details",
        },
      ],
      opportunities: [{ ...base, id: 11 }],
      contacts: [{ ...base, id: 13 }],
      leads: [],
      subscriptions: [
        { ...base, id: 90, code: `SUB-${companyId}`, recurringNextDate: due },
      ],
      "subscription-due-to-bill": [
        { ...base, id: 40, subscriptionId: 90, dueToBill: true },
      ],
      "scheduled-reports": [
        {
          ...base,
          id: 50,
          name: `Schedule ${companyId}`,
          isActive: true,
          nextRun: due,
        },
      ],
    };
    if (resource !== "companies") {
      expect(url.searchParams.get("organizationId")).toBe("7");
      scopeReads.push(`${resource}:${companyId}`);
    }
    await route.fulfill({ json: { data: records[resource ?? ""] ?? [] } });
  });

  await page.goto("/daily-work-sources");
  const crm = page.getByTestId("daily-work-crm");
  const billing = page.getByTestId("daily-work-billing");
  const schedules = page.getByTestId("daily-work-schedules");
  await expect(crm.getByRole("alert")).toContainText(
    "Only follow-ups with a verified source record are shown",
  );
  await expect(
    crm.getByRole("link", { name: "Review follow-up Call for company 11" }),
  ).toHaveAttribute("href", "/crm?tab=activities&filter=id%3A10");
  await expect(crm.getByText("Check contact details")).toHaveCount(0);
  await expect(
    billing.getByRole("link", { name: "Review billing for SUB-11" }),
  ).toHaveAttribute("href", "/subscriptions/90?tab=billing");
  await expect(
    schedules.getByRole("link", { name: "Review schedule Schedule 11" }),
  ).toHaveAttribute("href", "/reports?tab=scheduled-reports&filter=id%3A50");

  const previousActivityReads = scopeReads.filter(
    (entry) => entry === "activities:11",
  ).length;
  contactsAvailable = true;
  await crm.getByRole("button", { name: "Retry" }).click();
  await expect(crm.getByText("Check contact details")).toBeVisible();
  await expect(crm.getByRole("alert")).toHaveCount(0);
  expect(scopeReads.filter((entry) => entry === "activities:11")).toHaveLength(
    previousActivityReads,
  );

  await page.getByRole("button", { name: "Switch company" }).click();
  await expect(billing.getByText("SUB-11")).toHaveCount(0);
  await expect(billing.getByText("SUB-22")).toBeVisible();
  await expect(schedules.getByText("Schedule 22")).toBeVisible();
  await page.getByRole("button", { name: "Revoke billing" }).click();
  await expect(billing).toHaveCount(0);
  await expect(schedules.getByText("Schedule 22")).toBeVisible();
});
