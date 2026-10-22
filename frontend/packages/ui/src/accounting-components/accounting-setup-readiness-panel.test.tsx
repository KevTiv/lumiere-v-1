// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountingSetupReadinessInput } from "./accounting-setup-readiness";
import { AccountingSetupReadinessPanel } from "./accounting-setup-readiness-panel";

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
  }),
}));

afterEach(cleanup);

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
  taxConfiguration: "not-required",
};

describe("AccountingSetupReadinessPanel", () => {
  it("explains why invoice creation is unavailable and emits the selected fix", () => {
    const onResolve = vi.fn();
    render(
      <AccountingSetupReadinessPanel
        setup={{ ...readySetup, receivableAccountConfigured: false }}
        action="invoice"
        onResolve={onResolve}
      />,
    );

    expect(screen.getByText("Invoice creation needs setup")).toBeTruthy();
    expect(
      screen.getByText(
        "Customer balances need an account classified as receivable.",
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Assign receivable account" }),
    );
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "receivable-account",
        severity: "blocking",
      }),
    );
  });

  it("shows readiness when every required bill setting exists", () => {
    render(<AccountingSetupReadinessPanel setup={readySetup} action="bill" />);

    expect(screen.getByText("Bill creation is ready")).toBeTruthy();
    expect(
      screen.getByText("All required accounting setup is complete."),
    ).toBeTruthy();
  });
});
