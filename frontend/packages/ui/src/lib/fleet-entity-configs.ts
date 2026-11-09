import { createElement, type MouseEvent } from "react";
import Link from "next/link";
import { accountMoveHref } from "@lumiere/erp-shared/record-links";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type { TFunction } from "i18next";
import type { EntityColumn, EntityViewConfig } from "./entity-view-types";
import { entityColumnLayouts as layout } from "./entity-column-layouts";

export const fleetVehiclesTableConfig = (
  t: TFunction,
  options: { vehicleTypes?: readonly string[] } = {},
): EntityViewConfig => ({
  id: "fleet-vehicles-table",
  title: t("fleet.subtitle"),
  description: t("fleet.forms.newVehicle.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchPlaceholder: `${t("fleet.table.name")}, ${t("fleet.table.licensePlate")}…`,
    searchKeys: [
      "name",
      "license_plate",
      "vehicle_type",
      "driver_name",
      "status",
    ],
    filters: [
      {
        key: "status",
        label: t("fleet.table.status"),
        type: "select",
        faceted: true,
        options: [
          {
            value: "active",
            label: t("fleet.workspace.status.active", {
              defaultValue: "Active",
            }),
          },
          {
            value: "idle",
            label: t("fleet.workspace.status.idle", { defaultValue: "Idle" }),
          },
          {
            value: "maintenance",
            label: t("fleet.workspace.status.maintenance", {
              defaultValue: "Maintenance",
            }),
          },
          {
            value: "offline",
            label: t("fleet.workspace.status.offline", {
              defaultValue: "Offline",
            }),
          },
        ],
      },
      ...(options.vehicleTypes?.length
        ? [
            {
              key: "vehicle_type",
              label: t("fleet.table.vehicleType"),
              type: "select" as const,
              faceted: true,
              options: options.vehicleTypes.map((value) => ({
                value,
                label: value,
              })),
            },
          ]
        : []),
    ],
    columns: [
      { key: "name", label: t("fleet.table.name"), layout: layout.identity },
      {
        key: "license_plate",
        label: t("fleet.table.licensePlate"),
        layout: layout.reference,
      },
      {
        key: "driver_name",
        label: t("fleet.table.driverName"),
        layout: layout.location,
      },
      { key: "status", label: t("fleet.table.status"), type: "badge", layout: layout.status },
      {
        key: "odometer_km",
        label: t("fleet.table.odometer"),
        type: "number",
        layout: layout.quantity,
        align: "right",
      },
      {
        key: "last_position_at",
        label: t("fleet.table.lastPosition"),
        type: "datetime",
        layout: layout.date,
      },
      {
        key: "vehicle_type",
        label: t("fleet.table.vehicleType"),
        layout: layout.status,
      },
      {
        key: "id",
        label: "ID",
        defaultHidden: true,
        layout: layout.reference,
      },
    ],
    emptyMessage: t("fleet.empty"),
  },
});

const historyVehicleColumn = (t: TFunction): EntityColumn => ({
  key: "vehicle_name",
  label: t("fleet.lifecycle.vehicle"),
  layout: layout.identity,
  render: (name, row) =>
    [name, row.vehicle_plate]
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .join(" · ") || "—",
});

export const fleetServiceRecordsTableConfig = (
  t: TFunction,
): EntityViewConfig => ({
  id: "fleet-service-records-table",
  title: t("fleet.lifecycle.service.title"),
  description: t("fleet.lifecycle.service.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: [
      "vehicle_name",
      "vehicle_plate",
      "vehicle_id",
      "service_type_name",
      "provider",
      "notes",
    ],
    columns: [
      historyVehicleColumn(t),
      { key: "service_type_name", label: t("fleet.lifecycle.serviceType"), layout: layout.location },
      {
        key: "serviced_at",
        label: t("fleet.lifecycle.servicedAt"),
        type: "datetime",
        layout: layout.date,
      },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number", align: "right", layout: layout.quantity },
      { key: "provider", label: t("fleet.lifecycle.provider"), layout: layout.location },
      {
        key: "cost_amount",
        label: t("fleet.lifecycle.costAmount"),
        type: "number",
        layout: layout.amount,
        align: "right",
      },
      { key: "currency_name", label: t("fleet.lifecycle.currency"), layout: layout.unit },
      {
        key: "account_move_id",
        label: t("fleet.lifecycle.accountMove"),
        layout: layout.reference,
        render: (value) => {
          const id = parseStrictU64(value);
          return id == null
            ? "—"
            : createElement(
                Link,
                {
                  href: accountMoveHref(id),
                  "aria-label": `${t("fleet.lifecycle.accountMove")} #${id}`,
                  className: "underline underline-offset-4",
                  onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                    event.stopPropagation(),
                },
                `#${id}`,
              );
        },
      },
      { key: "notes", type: "markdown", label: t("fleet.lifecycle.notes"), layout: layout.description },
    ],
    emptyMessage: t("fleet.lifecycle.service.empty"),
  },
});

export const fleetInspectionsTableConfig = (
  t: TFunction,
): EntityViewConfig => ({
  id: "fleet-inspections-table",
  title: t("fleet.lifecycle.inspections.title"),
  description: t("fleet.lifecycle.inspections.description"),
  view: {
    mode: "table",
    rowKey: "id",
    searchable: true,
    searchKeys: [
      "vehicle_name",
      "vehicle_plate",
      "vehicle_id",
      "inspector_name",
      "outcome",
      "notes",
    ],
    columns: [
      historyVehicleColumn(t),
      { key: "inspector_name", label: t("fleet.lifecycle.inspector"), layout: layout.location },
      {
        key: "inspected_at",
        label: t("fleet.lifecycle.inspectedAt"),
        type: "datetime",
        layout: layout.date,
      },
      { key: "outcome", label: t("fleet.lifecycle.outcome"), type: "badge", layout: layout.status },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number", align: "right", layout: layout.quantity },
      { key: "notes", type: "markdown", label: t("fleet.lifecycle.notes"), layout: layout.description },
    ],
    emptyMessage: t("fleet.lifecycle.inspections.empty"),
  },
});
