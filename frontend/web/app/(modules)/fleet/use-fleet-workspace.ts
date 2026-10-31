"use client";

import { useErpSession } from "@lumiere/erp-session";
import { useTranslation } from "@lumiere/i18n";
import {
  useFleetInspections,
  useFleetServiceRecords,
  useFleetServiceTypes,
  useFleetVehicles,
} from "@lumiere/query-hooks/hooks/fleet";
import { useEmployees } from "@lumiere/query-hooks/hooks/hr/employees";
import {
  useAccountAccounts,
  useAccountJournals,
} from "@lumiere/query-hooks/hooks/accounting";
import { useCurrencies } from "@lumiere/query-hooks/hooks/settings";
import { useOperatingCompanyBigInt } from "@lumiere/query-hooks/hooks/use-operating-company";
import type { FleetVehicle } from "@lumiere/stdb/types";
import type { EntityRow } from "@lumiere/ui/lib/entity-view-types";
import {
  moduleCollection,
  type ModuleDataState,
} from "@lumiere/ui/lib/module-data-state";
import {
  fleetCompanyRows,
  fleetHistoryRows,
  fleetVehicleRows,
} from "./fleet-workspace";

/** Shared read model for the list and record page: every join uses the same operating-company boundary. */
export function useFleetWorkspace(
  organizationId: number,
  initialVehicles?: FleetVehicle[],
) {
  const { t } = useTranslation();
  const orgId = BigInt(organizationId);
  const { activeCompanyReady } = useErpSession();
  const resolvedCompany = useOperatingCompanyBigInt(organizationId);
  const company = activeCompanyReady ? resolvedCompany : undefined;
  const vehiclesRead = moduleCollection(
    useFleetVehicles(orgId, initialVehicles),
  );
  const employeesRead = moduleCollection(useEmployees(orgId));
  const serviceTypesRead = moduleCollection(useFleetServiceTypes(orgId));
  const serviceRead = moduleCollection(useFleetServiceRecords(orgId));
  const inspectionsRead = moduleCollection(useFleetInspections(orgId));
  const journalsRead = moduleCollection(useAccountJournals(orgId));
  const accountsRead = moduleCollection(useAccountAccounts(orgId));
  const currenciesRead = moduleCollection(useCurrencies());
  const scoped = (rows: readonly EntityRow[], organizationWide = false) =>
    fleetCompanyRows(rows, orgId, company, organizationWide);
  const vehicles = fleetVehicleRows(
    scoped(vehiclesRead.rows as unknown as EntityRow[]),
  );
  const employees = scoped(employeesRead.rows as unknown as EntityRow[]);
  const employeeChoices =
    employeesRead.state.status === "ready" ? employees : [];
  const serviceTypes = scoped(serviceTypesRead.rows, true);
  const activeServiceTypes = serviceTypes.filter(
    (row) => (row.is_active ?? row.isActive) === true,
  );
  const journals = scoped(journalsRead.rows as unknown as EntityRow[]);
  const accounts = scoped(accountsRead.rows as unknown as EntityRow[]);
  const lookups = {
    vehicles,
    serviceTypes,
    employees,
    currencies: currenciesRead.rows,
  };
  const serviceRecords = fleetHistoryRows(scoped(serviceRead.rows), lookups);
  const inspections = fleetHistoryRows(scoped(inspectionsRead.rows), lookups);
  const scopeState: ModuleDataState = !activeCompanyReady
    ? { status: "loading" }
    : company == null
      ? {
          status: "error",
          message: t("fleet.workspace.companyRequired", {
            defaultValue:
              "Select an operating company to view and manage its vehicles.",
          }),
        }
      : { status: "ready" };
  const ready = (...states: ModuleDataState[]) =>
    scopeState.status === "ready" &&
    states.every((state) => state.status === "ready");
  // Unassigning a driver and recording an inspection without an inspector do
  // not require HR access. Non-empty employee choices require a ready HR read.
  const assignmentReady = ready(vehiclesRead.state);
  const inspectionReady = ready(vehiclesRead.state, inspectionsRead.state);
  const serviceLookupsReady = ready(
    vehiclesRead.state,
    serviceRead.state,
    serviceTypesRead.state,
    journalsRead.state,
    accountsRead.state,
  );
  const serviceReady =
    serviceLookupsReady &&
    activeServiceTypes.length > 0 &&
    journals.length > 0 &&
    accounts.length >= 2;

  return {
    orgId,
    company,
    scopeState,
    vehicles,
    employees,
    employeeChoices,
    serviceTypes,
    activeServiceTypes,
    journals,
    accounts,
    serviceRecords,
    inspections,
    assignmentReady,
    inspectionReady,
    serviceReady,
    serviceLookupsReady,
    states: {
      vehicles: vehiclesRead.state,
      employees: employeesRead.state,
      serviceTypes: serviceTypesRead.state,
      service: serviceRead.state,
      inspections: inspectionsRead.state,
      journals: journalsRead.state,
      accounts: accountsRead.state,
      currencies: currenciesRead.state,
    },
  };
}
