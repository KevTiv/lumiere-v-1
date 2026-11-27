"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { useErpSession } from "@lumiere/erp-session";
import { useTranslation } from "@lumiere/i18n";
import { buildEntitySelection } from "@lumiere/query-hooks/ai-ui-context";
import {
  ModuleView,
  fleetVehiclesTableConfig,
  MissingOrganization,
  type EntityRow,
  type ModuleConfig,
} from "@lumiere/ui";
import { ModuleDataNotice } from "@lumiere/ui/pages/module-data-notice";
import { mergeModuleStates } from "@lumiere/ui/lib/module-data-state";
import { fleetModuleConfig } from "@/lib/module-dashboard-configs";
import { useFleetModuleSubscription } from "@/lib/module-subscription-hooks";
import { hasValidOrganizationId } from "@/lib/org-scoped";
import { useOpenErpAiChat } from "@/lib/erp-ai-context";
import {
  accountAccountRowsToSelectOptions,
  accountJournalRowsToSelectOptions,
} from "@/lib/form-lookup";
import type { FleetVehicle } from "@lumiere/stdb/types";
import { fleetVehicleChoiceLabel, fleetVehicleTypes } from "./fleet-workspace";
import { fleetVehicleRecordHref } from "./fleet-record";
import { useFleetActions } from "./fleet-actions";
import { useFleetWorkspace } from "./use-fleet-workspace";
import { FleetRecoveryNotice } from "./fleet-recovery-notice";
import { canRecordFleetServiceWith } from "./fleet-service-setup";
import { FleetServiceSetupNotice } from "./fleet-service-setup-notice";

interface FleetClientProps {
  initialVehicles?: FleetVehicle[];
  organizationId?: number;
}

function FleetClientLoaded({
  initialVehicles,
  organizationId,
}: FleetClientProps & { organizationId: number }) {
  const { t } = useTranslation();
  const openErpAiChat = useOpenErpAiChat();
  useFleetModuleSubscription();
  const workspace = useFleetWorkspace(organizationId, initialVehicles);
  const fleetActions = useFleetActions(
    workspace.orgId,
    workspace.company,
    workspace.employeeChoices.map((row) => String(row.id)),
  );
  const {
    vehicles,
    employeeChoices: employees,
    serviceChoices,
  } = workspace;
  const options = (rows: EntityRow[]) =>
    rows.map((row) => ({
      value: String(row.id),
      label: String(
        row.name ?? row.display_name ?? row.displayName ?? `#${row.id}`,
      ),
    }));

  const config = useMemo<ModuleConfig>(() => {
    const base = fleetModuleConfig(t, {
      vehicles: vehicles.map((row) => ({ value: String(row.id), label: fleetVehicleChoiceLabel(row) })),
      employees: options(employees),
      serviceTypes: options(serviceChoices.serviceType),
      journals: accountJournalRowsToSelectOptions(serviceChoices.journal),
      expenseAccounts: accountAccountRowsToSelectOptions(serviceChoices.expenseAccount),
      offsetAccounts: accountAccountRowsToSelectOptions(serviceChoices.offsetAccount),
    });
    return {
      ...base,
      tabs: base.tabs.map((tab) => {
        const historyEntity =
          tab.id === "fleet-service-records" ? "fleet_service_record" :
          tab.id === "fleet-inspections" ? "fleet_inspection" : undefined;
        const entityConfig = tab.entityConfig;
        if (historyEntity && entityConfig?.view.mode === "table") {
          tab = {
            ...tab,
            entityConfig: {
              ...entityConfig,
              view: {
                ...entityConfig.view,
                rowActions: [
                  ...entityConfig.view.rowActions ?? [],
                  {
                    id: "ask-about-record",
                    label: t("aiChat.workspace.askAboutRecord", { defaultValue: "Ask Lumière" }),
                    icon: Sparkles,
                    onClick: (row) => openErpAiChat({
                      selection: buildEntitySelection({ activeTab: tab.id, entityType: historyEntity, row }),
                    }),
                  },
                ],
              },
            },
          };
        }
        const formReady =
          tab.id === "fleet-vehicles"
            ? workspace.states.vehicles.status === "ready"
            : tab.id === "fleet-driver-assignment"
              ? workspace.assignmentReady
              : tab.id === "fleet-service-records"
                ? workspace.serviceFormReady
                : workspace.inspectionReady;
        return {
          ...tab,
          createPermission: {
            resource: "fleet_vehicle",
            action:
              tab.id === "fleet-vehicles"
                ? ("create" as const)
                : ("write" as const),
          },
          createForm:
            formReady && workspace.scopeState.status === "ready"
              ? tab.createForm
              : undefined,
          ...(tab.id === "fleet-vehicles" ||
          tab.id === "fleet-driver-assignment"
            ? {
                entityConfig: fleetVehiclesTableConfig(t, {
                  vehicleTypes: fleetVehicleTypes(vehicles),
                }),
                recordSheet: {
                  titleKey: "name",
                  auditTableName: "fleet_vehicle",
                  discussion: {},
                  openHref: fleetVehicleRecordHref,
                  detailConfig: {
                    mode: "detail" as const,
                    sections: [
                      {
                        id: "vehicle",
                        fields: [
                          {
                            key: "license_plate",
                            label: t("fleet.table.licensePlate"),
                          },
                          {
                            key: "vehicle_type",
                            label: t("fleet.table.vehicleType"),
                          },
                          {
                            key: "driver_name",
                            label: t("fleet.table.driverName"),
                          },
                          { key: "status", label: t("fleet.table.status"), type: "badge" as const },
                          {
                            key: "odometer_km",
                            label: t("fleet.table.odometer"),
                            type: "number" as const,
                          },
                        ],
                      },
                    ],
                  },
                },
              }
            : {}),
        };
      }),
    };
  }, [
    t,
    vehicles,
    employees,
    serviceChoices,
    workspace.states.vehicles.status,
    workspace.assignmentReady,
    workspace.serviceFormReady,
    workspace.inspectionReady,
    workspace.scopeState.status,
    openErpAiChat,
  ]);

  if (workspace.scopeState.status !== "ready")
    return workspace.scopeState.status === "loading" ? (
      <p role="status">{t("common.loading", { defaultValue: "Loading…" })}</p>
    ) : (
      <ModuleDataNotice state={workspace.scopeState} />
    );

  return (
    <>
      <FleetRecoveryNotice
        key={`${organizationId}:${workspace.company}`}
        actions={fleetActions}
      />
      <ModuleView
        key={`${organizationId}:${workspace.company}`}
        config={config}
        data={{
          "fleet-vehicles": vehicles,
          "fleet-driver-assignment": vehicles,
          "fleet-service-records": workspace.serviceRecords,
          "fleet-inspections": workspace.inspections,
        }}
        dataState={{
          "fleet-vehicles": workspace.states.vehicles,
          "fleet-driver-assignment": workspace.states.vehicles,
          "fleet-service-records": mergeModuleStates([
            workspace.states.service,
            workspace.states.vehicles,
          ]),
          "fleet-inspections": mergeModuleStates([
            workspace.states.inspections,
            workspace.states.vehicles,
          ]),
        }}
        renderCreatePreview={(tabId) => tabId === "fleet-service-records" && workspace.needsServiceSetup
          ? <FleetServiceSetupNotice workspace={workspace} />
          : null}
        isPending={fleetActions.isPending}
        onFormSubmit={async (_tabId, action, formData) => {
          if (action === "recordFleetService" && (!workspace.serviceLookupsReady || !canRecordFleetServiceWith(serviceChoices, formData))) {
            throw new Error(t("fleet.workspace.recovery.choicesChanged"));
          }
          await fleetActions.submit(action, formData);
        }}
      />
    </>
  );
}

export function FleetClient({
  initialVehicles,
  organizationId,
}: FleetClientProps) {
  const { identity, activeCompanyId, activeCompanyReady } = useErpSession();
  if (!hasValidOrganizationId(organizationId)) return <MissingOrganization />;
  return (
    <FleetClientLoaded
      key={`${identity}:${organizationId}:${activeCompanyReady}:${activeCompanyId}`}
      initialVehicles={initialVehicles}
      organizationId={organizationId}
    />
  );
}
