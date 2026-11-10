import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  pathname: "/products", search: "tab=products&filter=name%3ABreast&history=activity",
  push: vi.fn(), replace: vi.fn(), allowed: true, ready: true,
  session: { organizationId: 7, activeCompanyId: 11, activeCompanyReady: true, identity: "ab".repeat(32) as string | null },
}));
vi.mock("next/navigation", () => ({ usePathname: () => controls.pathname, useSearchParams: () => new URLSearchParams(controls.search),
  useRouter: () => ({ push: controls.push, replace: controls.replace }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => controls.session }));
vi.mock("@lumiere/ui/lib/rbac-context", () => ({ useRBAC: () => ({ permissionsReady: controls.ready, checkPermission: () => ({ allowed: controls.allowed }) }) }));
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }));
vi.mock("@lumiere/ui/components/sheet", () => ({
  Sheet: ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (value: boolean) => void; children: ReactNode }) => open ? <section><button onClick={() => onOpenChange(false)}>Close drawer</button>{children}</section> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("@lumiere/ui/entity-views/record-business-history", () => ({
  ModuleBusinessHistory: ({ moduleId, renderRecordLink }: { moduleId: string; renderRecordLink?: (entry: { resource: string; recordId: string }) => ReactNode }) => <div>Activity for {moduleId}{renderRecordLink?.({ resource: "product", recordId: "9007199254740993" })}</div>,
  RecordBusinessHistory: ({ tableName, recordId }: { tableName: string; recordId: string }) => <p>Selected history {tableName}:{recordId}</p>,
}));

import { ModuleActivity } from "../../../../web/components/module-activity";

afterEach(cleanup);
beforeEach(() => {
  Object.assign(controls, { pathname: "/products", search: "tab=products&filter=name%3ABreast&history=activity", allowed: true, ready: true });
  Object.assign(controls.session, { organizationId: 7, activeCompanyId: 11, activeCompanyReady: true, identity: "ab".repeat(32) });
  vi.clearAllMocks();
});

describe("module activity scope and navigation", () => {
  it("opens and closes activity through the URL while retaining workspace filters", () => {
    controls.search = "tab=products&filter=name%3ABreast";
    const view = render(<ModuleActivity />);
    expect(screen.queryByText("Activity for products")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(controls.push).toHaveBeenCalledWith("/products?tab=products&filter=name%3ABreast&history=activity", { scroll: false });
    controls.search = "tab=products&filter=name%3ABreast&history=activity";
    view.rerender(<ModuleActivity />);
    expect(screen.getByText("Activity for products")).toBeTruthy();
    fireEvent.click(screen.getByText("Close drawer"));
    expect(controls.replace).toHaveBeenCalledWith("/products?tab=products&filter=name%3ABreast", { scroll: false });
    controls.search = "tab=products&filter=name%3ABreast";
    view.rerender(<ModuleActivity />);
    expect(screen.queryByText("Activity for products")).toBeNull();
  });

  it("opens exact record history even when the aggregate is inspected through a list workspace", () => {
    render(<ModuleActivity />);
    fireEvent.click(screen.getByText("History & sources", { selector: "button" }));
    expect(screen.getByText("Selected history product:9007199254740993")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open record" }).getAttribute("href")).toBe("/products?tab=products&filter=id%3A9007199254740993");
  });

  it.each(["company", "organization", "actor", "module"])("hides a previously selected record after a %s scope change", (kind) => {
    const view = render(<ModuleActivity />);
    fireEvent.click(screen.getByText("History & sources", { selector: "button" }));
    if (kind === "company") controls.session.activeCompanyId = 22;
    if (kind === "organization") controls.session.organizationId = 8;
    if (kind === "actor") controls.session.identity = "ef".repeat(32);
    if (kind === "module") controls.pathname = "/warehouse";
    view.rerender(<ModuleActivity />);
    expect(screen.queryByText("Selected history product:9007199254740993")).toBeNull();
  });

  it.each(["permission", "loading", "company", "identity", "hidden-module"])("withholds activity when %s is unavailable", (kind) => {
    if (kind === "permission") controls.allowed = false;
    if (kind === "loading") controls.ready = false;
    if (kind === "company") controls.session.activeCompanyReady = false;
    if (kind === "identity") controls.session.identity = null;
    if (kind === "hidden-module") controls.pathname = "/manufacturing";
    render(<ModuleActivity />);
    expect(screen.queryByText("Activity for products")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
