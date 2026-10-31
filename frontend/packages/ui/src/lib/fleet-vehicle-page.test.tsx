import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { Button } from "../components/button";
import { Badge } from "../components/badge";
import { Skeleton } from "../components/skeleton";
import * as empty from "../components/empty";
import { MissingOrganization } from "../components/missing-organization";
import { RecordPage } from "../entity-views/record-page";
import { SmartButtons } from "../entity-views/smart-buttons";
import { ModuleDataNotice } from "../pages/module-data-notice";
import * as moduleData from "./module-data-state";
import * as fleetConfigs from "./fleet-entity-configs";
import * as fleetForms from "./fleet-form-configs";
import { mergeFieldDefaultValues } from "./form-config-merge";
import type { FormConfig, SelectField } from "./form-types";
import * as fleetWorkspace from "../../../../web/app/(modules)/fleet/fleet-workspace";
import * as fleetRecord from "../../../../web/app/(modules)/fleet/fleet-record";

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

type Row = Record<string, unknown>;
type Query = {
  data: Row[];
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: ReturnType<typeof vi.fn>;
};
const ready = (data: Row[] = []): Query => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});
const session = {
  identity: "actor",
  organizationId: 7,
  activeCompanyId: 8 as number | null,
  activeCompanyReady: true,
};
let permitted = true;
let query: Record<string, Query>;
let search = "";
const submitFleet = vi.fn(async (_action: string, _values: Row) => undefined);
const translate = (key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key;

/** Mount the production page and read hook; isolate transport, session and unrelated record tools. */
function productionExports(
  path: string,
  dependencies: Record<string, unknown>,
) {
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
      return dependencies[name];
    },
    URLSearchParams,
  });
  return exports;
}

const shared = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@lumiere/erp-session": { useErpSession: () => session },
  "@lumiere/i18n": { useTranslation: () => ({ t: translate }) },
  "@lumiere/ui/lib/module-data-state": moduleData,
};
const workspace = productionExports(
  "../../../../web/app/(modules)/fleet/use-fleet-workspace.ts",
  {
    ...shared,
    "@lumiere/query-hooks/hooks/fleet": {
      useFleetVehicles: () => query.vehicles,
      useFleetServiceRecords: () => query.service,
      useFleetInspections: () => query.inspections,
      useFleetServiceTypes: () => query.types,
    },
    "@lumiere/query-hooks/hooks/hr/employees": {
      useEmployees: () => query.employees,
    },
    "@lumiere/query-hooks/hooks/accounting": {
      useAccountAccounts: () => query.accounts,
      useAccountJournals: () => query.journals,
    },
    "@lumiere/query-hooks/hooks/settings": {
      useCurrencies: () => query.currencies,
    },
    "@lumiere/query-hooks/hooks/use-operating-company": {
      useOperatingCompanyBigInt: (organizationId: number) => {
        expect(organizationId).toBe(7);
        return session.activeCompanyId == null
          ? undefined
          : BigInt(session.activeCompanyId);
      },
    },
    "./fleet-workspace": fleetWorkspace,
  },
);
const page = productionExports(
  "../../../../web/app/(modules)/fleet/vehicles/[id]/vehicle-page-client.tsx",
  {
    ...shared,
    "next/link": {
      default: ({ children, ...props }: React.ComponentProps<"a">) => (
        <a {...props}>{children}</a>
      ),
    },
    "next/navigation": {
      useRouter: () => ({ replace: vi.fn() }),
      usePathname: () => "/fleet/vehicles/41",
      useSearchParams: () => new URLSearchParams(search),
    },
    "lucide-react": { ClipboardCheck: () => null, Wrench: () => null },
    "@lumiere/ui": {
      ...empty,
      ...fleetConfigs,
      ...fleetForms,
      Button,
      MissingOrganization,
      RecordPage,
      SmartButtons,
      mergeFieldDefaultValues,
      buildModuleTabHref: () => "/fleet?tab=fleet-vehicles",
      EntityDetail: ({ data }: { data: Row }) => (
        <output data-testid="vehicle-detail">
          {String(data.license_plate ?? "")}
        </output>
      ),
      EntityView: ({ data }: { data: Row[] }) => (
        <div data-testid="history-table">
          {data.map((row) => (
            <span key={String(row.id)}>{String(row.notes ?? row.id)}</span>
          ))}
        </div>
      ),
      FormModal: ({
        config,
        onSubmit,
      }: {
        config: FormConfig;
        onSubmit: (values: Row) => Promise<void>;
      }) => {
        const fields = config.sections.flatMap((section) => section.fields);
        const employee = fields.find(
          (field): field is SelectField =>
            field.type === "select" &&
            (field.name === "inspector_id" || field.name === "driver_id"),
        );
        const values = Object.fromEntries(
          fields.map((field) => [field.name, field.defaultValue ?? ""]),
        );
        if (employee)
          values[employee.name] = employee.options?.[0]?.value ?? "";
        return (
          <div data-testid="vehicle-form">
            {employee?.description ? <p>{employee.description}</p> : null}
            {employee ? (
              <select aria-label="Employee choice">
                {employee.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              onClick={() => {
                void onSubmit(values);
              }}
            >
              Save fixture form
            </button>
          </div>
        );
      },
      RecordAuditTab: () => null,
      RecordChatter: () => null,
    },
    "@lumiere/ui/components/badge": { Badge },
    "@lumiere/ui/components/skeleton": { Skeleton },
    "@lumiere/ui/lib/workflow-toast": { showWorkflowToast: vi.fn() },
    "@lumiere/ui/pages/module-data-notice": { ModuleDataNotice },
    "@lumiere/ui/lib/rbac-context": {
      useRBAC: () => ({
        permissionsReady: true,
        checkPermission: () => ({ allowed: permitted }),
      }),
    },
    "@/lib/form-lookup": {
      accountAccountRowsToSelectOptions: () => [],
      accountJournalRowsToSelectOptions: () => [],
    },
    "@/hooks/use-record-navigation": { useRecordNavigation: () => undefined },
    "@/lib/module-subscription-hooks": {
      useFleetModuleSubscription: () => undefined,
    },
    "@/lib/org-scoped": {
      hasValidOrganizationId: (id: number) => Number.isInteger(id) && id > 0,
    },
    "../../../../../components/record-header-actions": {
      RecordHeaderActions: () => (
        <button data-testid="edit-vehicle">Edit vehicle</button>
      ),
    },
    "./vehicle-location-map": { VehicleLocationMap: () => null },
    "../../fleet-actions": {
      useFleetActions: () => ({
        submit: submitFleet,
        isPending: false,
        recovery: null,
      }),
    },
    "../../fleet-record": fleetRecord,
    "../../use-fleet-workspace": workspace,
    "../../fleet-recovery-notice": { FleetRecoveryNotice: () => null },
    "../../fleet-service-setup-notice": { FleetServiceSetupNotice: () => null },
  },
);
const VehiclePageClient = page.VehiclePageClient as React.ComponentType<{
  organizationId: number;
  vehicleId: string;
}>;
const view = () => <VehiclePageClient organizationId={7} vehicleId="41" />;

beforeEach(() => {
  Object.assign(session, {
    identity: "actor",
    activeCompanyId: 8,
    activeCompanyReady: true,
  });
  permitted = true;
  submitFleet.mockClear();
  search = "";
  query = Object.fromEntries(
    [
      "vehicles",
      "service",
      "inspections",
      "types",
      "employees",
      "accounts",
      "journals",
      "currencies",
    ].map((key) => [key, ready()]),
  );
  query.vehicles = ready([
    {
      id: "41",
      organizationId: 7,
      companyId: 8,
      name: "Owned delivery van",
      licensePlate: "RAA 201",
      vehicleType: "van",
      status: "Active",
    },
    {
      id: "42",
      organizationId: 7,
      companyId: 9,
      name: "Other company truck",
      licensePlate: "OTHER",
      vehicleType: "truck",
      status: "Active",
    },
  ]);
});
afterEach(cleanup);

describe("Fleet vehicle record read and action boundaries", () => {
  it("distinguishes loading, failed reads and a genuinely missing vehicle", () => {
    query.vehicles = { ...ready(), isLoading: true };
    const { rerender } = render(view());
    expect(screen.getByTestId("vehicle-page-loading")).toBeTruthy();
    expect(screen.queryByTestId("vehicle-page-not-found")).toBeNull();
    query.vehicles = { ...ready(), isError: true, error: new Error("offline") };
    rerender(view());
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded",
    );
    expect(screen.queryByTestId("vehicle-page-not-found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(query.vehicles.refetch).toHaveBeenCalledOnce();
    query.vehicles = ready();
    rerender(view());
    expect(screen.getByTestId("vehicle-page-not-found").textContent).toContain(
      "Vehicle not found",
    );
    expect(
      screen
        .getByRole("button", { name: "Back to vehicles" })
        .getAttribute("href"),
    ).toBe("/fleet?tab=fleet-vehicles");
  });

  it("removes cached vehicle identity and controls on access denial", () => {
    const { rerender } = render(view());
    expect(screen.getByTestId("vehicle-title").textContent).toBe(
      "Owned delivery van",
    );
    query.vehicles = {
      ...query.vehicles!,
      isError: true,
      error: { status: 403 },
    };
    rerender(view());
    expect(screen.getByRole("status").textContent).toContain(
      "do not have access",
    );
    expect(screen.queryByTestId("vehicle-title")).toBeNull();
    expect(screen.queryByTestId("edit-vehicle")).toBeNull();
    expect(screen.queryByTestId("vehicle-page-not-found")).toBeNull();
  });

  it("does not widen an unresolved company and drops the previous company's record on a switch", () => {
    session.activeCompanyReady = false;
    const { rerender } = render(view());
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    expect(screen.queryByTestId("vehicle-title")).toBeNull();
    Object.assign(session, { activeCompanyReady: true, activeCompanyId: null });
    rerender(view());
    expect(screen.getByRole("alert").textContent).toContain(
      "Select an operating company",
    );
    session.activeCompanyId = 8;
    rerender(view());
    expect(screen.getByTestId("vehicle-title").textContent).toBe(
      "Owned delivery van",
    );
    expect(screen.queryByText("Other company truck")).toBeNull();
    session.activeCompanyId = 9;
    rerender(view());
    expect(screen.queryByTestId("vehicle-title")).toBeNull();
    expect(screen.getByTestId("vehicle-page-not-found")).toBeTruthy();
  });

  it("keeps failed history distinct from zero records and disables dependent forms", () => {
    search = "tab=service";
    query.service = {
      ...ready([
        {
          id: "1",
          organizationId: 7,
          companyId: 8,
          vehicleId: "41",
          notes: "Stale garage work",
        },
      ]),
      isError: true,
      error: new Error("offline"),
    };
    query.inspections = { ...ready(), isLoading: true };
    render(view());
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded",
    );
    expect(screen.queryByTestId("history-table")).toBeNull();
    expect(screen.queryByTestId("vehicle-smart-service")).toBeNull();
    expect(screen.queryByTestId("vehicle-smart-inspections")).toBeNull();
    expect(
      (screen.getByTestId("vehicle-action-service") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("vehicle-action-inspection") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("labels partial reads and does not misreport a missing row as an authoritative absence", () => {
    query.vehicles = {
      ...ready([{ id: "42", organizationId: 7, companyId: 8 }]),
      isError: true,
      error: { status: 503 },
    };
    render(view());
    expect(screen.getByRole("alert").textContent).toContain("out of date");
    expect(screen.queryByTestId("vehicle-page-not-found")).toBeNull();
  });

  it("closes the vehicle form on an account switch and hides history actions without write permission", () => {
    const { rerender } = render(view());
    fireEvent.click(screen.getByTestId("vehicle-action-assign"));
    expect(screen.getByTestId("vehicle-form")).toBeTruthy();
    session.identity = "other-actor";
    rerender(view());
    expect(screen.queryByTestId("vehicle-form")).toBeNull();
    permitted = false;
    rerender(view());
    expect(screen.queryByTestId("vehicle-action-assign")).toBeNull();
    expect(screen.queryByTestId("vehicle-action-service")).toBeNull();
    expect(screen.queryByTestId("vehicle-action-inspection")).toBeNull();
  });

  it.each(["denied", "partial", "loading"])(
    "allows inspection without inspector and driver unassignment when HR is %s",
    async (state) => {
      query.employees = {
        ...ready([
          { id: "12", organizationId: 7, companyId: 8, name: "Stale employee" },
        ]),
        isLoading: state === "loading",
        isError: state !== "loading",
        error:
          state === "denied"
            ? { status: 403 }
            : state === "partial"
              ? { status: 503 }
              : undefined,
      };
      render(view());
      expect(
        (screen.getByTestId("vehicle-action-inspection") as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(
        (screen.getByTestId("vehicle-action-assign") as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      fireEvent.click(screen.getByTestId("vehicle-action-inspection"));
      expect(screen.queryByText("Stale employee")).toBeNull();
      expect(
        screen.getByText(
          "No employee choices are available. You can record the inspection without an inspector.",
        ),
      ).toBeTruthy();
      expect(
        Array.from(
          (
            screen.getByRole("combobox", {
              name: "Employee choice",
            }) as HTMLSelectElement
          ).options,
          (option) => option.value,
        ),
      ).toEqual(["none"]);
      fireEvent.click(
        screen.getByRole("button", { name: "Save fixture form" }),
      );
      await waitFor(() =>
        expect(submitFleet).toHaveBeenCalledWith(
          "recordFleetInspection",
          expect.objectContaining({
            vehicle_id: "41",
            inspector_id: "none",
            outcome: "passed",
          }),
        ),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("vehicle-form")).toBeNull(),
      );
      fireEvent.click(screen.getByTestId("vehicle-action-assign"));
      expect(
        screen.getByText(
          "No employee choices are available. You can still unassign the current driver.",
        ),
      ).toBeTruthy();
      expect(
        Array.from(
          (
            screen.getByRole("combobox", {
              name: "Employee choice",
            }) as HTMLSelectElement
          ).options,
          (option) => option.value,
        ),
      ).toEqual(["unassigned"]);
      fireEvent.click(
        screen.getByRole("button", { name: "Save fixture form" }),
      );
      await waitFor(() =>
        expect(submitFleet).toHaveBeenCalledWith(
          "assignFleetDriver",
          expect.objectContaining({
            vehicle_id: "41",
            driver_id: "unassigned",
          }),
        ),
      );
    },
  );
});
