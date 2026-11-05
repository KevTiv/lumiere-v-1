import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./record-business-history", () => ({ RecordBusinessHistory: () => <div>Scoped business history</div> }));
vi.mock("./legacy-record-audit-tab", () => ({ LegacyRecordAuditTab: () => <div>Limited legacy audit</div> }));
import { RecordAuditTab } from "./record-audit-tab";

afterEach(cleanup);
describe("record history compatibility", () => {
  it.each(["sale_order", "hr_expense_sheet", "stock_picking", "document"])("routes alpha %s records to scoped history", (tableName) => {
    render(<RecordAuditTab tableName={tableName} recordId="12" />);
    expect(screen.getByText("Scoped business history")).toBeTruthy();
    expect(screen.queryByText("Limited legacy audit")).toBeNull();
  });
  it.each(["project_project", "mrp_production", "pos_session"])("preserves existing %s history outside alpha", (tableName) => {
    render(<RecordAuditTab tableName={tableName} recordId="12" />);
    expect(screen.getByText("Limited legacy audit")).toBeTruthy();
    expect(screen.queryByText("Scoped business history")).toBeNull();
  });
});
