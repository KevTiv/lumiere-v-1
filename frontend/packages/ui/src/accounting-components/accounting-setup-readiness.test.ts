import { describe, expect, it } from "vitest";

import {
  evaluateAccountingSetupReadiness,
  type AccountingSetupReadinessInput,
} from "./accounting-setup-readiness";

const readySetup: AccountingSetupReadinessInput = {
  companyConfigured: true,
  baseCurrencyConfigured: true,
  fiscalYearConfigured: true,
  openPeriodAvailable: true,
  salesJournalConfigured: true,
  purchaseJournalConfigured: true,
  receivableAccountConfigured: true,
  payableAccountConfigured: true,
  incomeAccountConfigured: true,
  expenseAccountConfigured: true,
  taxConfiguration: "ready",
};

describe("evaluateAccountingSetupReadiness", () => {
  it("allows general journal drafts without inventing invoice or tax setup", () => {
    const setup: AccountingSetupReadinessInput = {
      ...readySetup,
      salesJournalConfigured: false,
      purchaseJournalConfigured: false,
      receivableAccountConfigured: false,
      payableAccountConfigured: false,
      incomeAccountConfigured: false,
      expenseAccountConfigured: false,
      taxConfiguration: "missing",
    };
    expect(evaluateAccountingSetupReadiness(setup, "journal-import").isReady).toBe(true);
    for (const action of ["invoice", "bill", "import"] as const) {
      expect(evaluateAccountingSetupReadiness(setup, action).blockingItems.map(item => item.id)).toContain("tax-configuration");
    }
    for (const field of ["companyConfigured", "baseCurrencyConfigured", "fiscalYearConfigured", "openPeriodAvailable"] as const) {
      expect(evaluateAccountingSetupReadiness({ ...setup, [field]: false }, "journal-import").isReady).toBe(false);
    }
  });
  it("reports a fully configured setup as ready", () => {
    const result = evaluateAccountingSetupReadiness(readySetup);

    expect(result.isReady).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("only applies sales-side account and journal requirements to invoices", () => {
    const result = evaluateAccountingSetupReadiness(
      {
        ...readySetup,
        purchaseJournalConfigured: false,
        payableAccountConfigured: false,
        expenseAccountConfigured: false,
      },
      "invoice",
    );

    expect(result.isReady).toBe(true);
    expect(result.blockingItems).toEqual([]);
  });

  it("only applies purchase-side account and journal requirements to bills", () => {
    const result = evaluateAccountingSetupReadiness(
      {
        ...readySetup,
        salesJournalConfigured: false,
        receivableAccountConfigured: false,
        incomeAccountConfigured: false,
      },
      "bill",
    );

    expect(result.isReady).toBe(true);
    expect(result.blockingItems).toEqual([]);
  });

  it("requires both invoice and bill foundations for historical imports", () => {
    const result = evaluateAccountingSetupReadiness(
      {
        ...readySetup,
        salesJournalConfigured: false,
        payableAccountConfigured: false,
      },
      "import",
    );

    expect(result.isReady).toBe(false);
    expect(result.blockingItems.map((item) => item.id)).toEqual([
      "sales-journal",
      "payable-account",
    ]);
  });

  it("keeps a pending tax review visible without blocking entry", () => {
    const result = evaluateAccountingSetupReadiness(
      { ...readySetup, taxConfiguration: "needs-review" },
      "invoice",
    );

    expect(result.isReady).toBe(true);
    expect(result.blockingItems).toEqual([]);
    expect(result.advisoryItems.map((item) => item.id)).toEqual(["tax-review"]);
  });

  it("blocks entry when tax applicability has not been resolved", () => {
    const result = evaluateAccountingSetupReadiness(
      { ...readySetup, taxConfiguration: "missing" },
      "bill",
    );

    expect(result.isReady).toBe(false);
    expect(result.blockingItems[0]).toMatchObject({
      id: "tax-configuration",
      actionLabel: "Configure taxes",
    });
  });
});
