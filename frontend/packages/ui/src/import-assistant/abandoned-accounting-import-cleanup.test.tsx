import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AbandonedAccountingImportCleanup } from "./abandoned-accounting-import-cleanup";

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? _key).replace(
        /\{\{(\w+)\}\}/g,
        (_, name) => String(options?.[name] ?? ""),
      ),
  }),
}));

const parent = {
  id: 41,
  table_name: "account_move",
  file_name: "opening-journals.csv",
  status: "success",
  metadata: JSON.stringify({
    company_id: 7,
    account_move_bundle_rollback: {
      version: 1,
      role: "parent",
      token: "bundle-1",
      parent_job_id: null,
    },
  }),
};

afterEach(cleanup);

describe("AbandonedAccountingImportCleanup", () => {
  it("stays hidden without explicit cleanup authorization", () => {
    render(
      <AbandonedAccountingImportCleanup
        jobs={[parent]}
        companyId={7n}
        authorized={false}
        onCleanup={vi.fn()}
      />,
    );
    expect(screen.queryByText("Abandoned journal import drafts")).toBeNull();
  });

  it("stays hidden when the matching line bundle completed", () => {
    const child = {
      id: 42,
      table_name: "account_move_line",
      status: "success",
      metadata: JSON.stringify({
        account_move_bundle_rollback: {
          version: 1,
          role: "complete",
          token: "bundle-1",
          parent_job_id: 41,
        },
      }),
    };
    render(
      <AbandonedAccountingImportCleanup
        jobs={[parent, child]}
        companyId={7n}
        authorized
        onCleanup={vi.fn()}
      />,
    );
    expect(screen.queryByText("Abandoned journal import drafts")).toBeNull();
  });

  it("requires confirmation and sends the parent job id", async () => {
    const onCleanup = vi.fn().mockResolvedValue(undefined);
    render(
      <AbandonedAccountingImportCleanup
        jobs={[parent]}
        companyId={7n}
        authorized
        onCleanup={onCleanup}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clean up empty drafts" }),
    );
    expect(
      screen.getByText(/Only its original empty draft journal entries/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clean up drafts" }));

    await waitFor(() => expect(onCleanup).toHaveBeenCalledWith(41));
  });

  it("shows the server refusal without claiming cleanup succeeded", async () => {
    const onCleanup = vi
      .fn()
      .mockRejectedValue(new Error("Journal entry 99 now has lines"));
    render(
      <AbandonedAccountingImportCleanup
        jobs={[parent]}
        companyId={7n}
        authorized
        onCleanup={onCleanup}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clean up empty drafts" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clean up drafts" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Cleanup was refused: Journal entry 99 now has lines",
    );
  });

  it("stays hidden outside the active company", () => {
    render(
      <AbandonedAccountingImportCleanup
        jobs={[parent]}
        companyId={8n}
        authorized
        onCleanup={vi.fn()}
      />,
    );
    expect(screen.queryByText("Abandoned journal import drafts")).toBeNull();
  });
});
