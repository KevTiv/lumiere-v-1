import { createElement, type MouseEvent } from "react";
import Link from "next/link";
import { accountMoveHref } from "@lumiere/erp-shared/record-links";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type { TFunction } from "i18next";
import type { EntityViewConfig } from "./entity-view-types";

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
      { key: "name", label: t("fleet.table.name"), width: "min-w-36" },
      {
        key: "vehicle_type",
        label: t("fleet.table.vehicleType"),
        width: "min-w-24",
      },
      {
        key: "license_plate",
        label: t("fleet.table.licensePlate"),
        width: "min-w-28",
      },
      {
        key: "driver_name",
        label: t("fleet.table.driverName"),
        width: "min-w-32",
      },
      { key: "status", label: t("fleet.table.status"), type: "badge" },
      {
        key: "odometer_km",
        label: t("fleet.table.odometer"),
        type: "number",
        align: "right",
      },
      {
        key: "last_position_at",
        label: t("fleet.table.lastPosition"),
        type: "datetime",
      },
      {
        key: "id",
        label: "ID",
        type: "number",
        align: "right",
        width: "min-w-16",
      },
    ],
    emptyMessage: t("fleet.empty"),
  },
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
      "vehicle_id",
      "service_type_name",
      "provider",
      "notes",
    ],
    columns: [
      { key: "vehicle_name", label: t("fleet.lifecycle.vehicle") },
      { key: "service_type_name", label: t("fleet.lifecycle.serviceType") },
      {
        key: "serviced_at",
        label: t("fleet.lifecycle.servicedAt"),
        type: "datetime",
      },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number" },
      { key: "provider", label: t("fleet.lifecycle.provider") },
      {
        key: "cost_amount",
        label: t("fleet.lifecycle.costAmount"),
        type: "number",
        align: "right",
      },
      { key: "currency_name", label: t("fleet.lifecycle.currency") },
      {
        key: "account_move_id",
        label: t("fleet.lifecycle.accountMove"),
        render: (value) => {
          const id = parseStrictU64(value);
          return id == null
            ? "—"
            : createElement(
                Link,
                {
                  href: accountMoveHref(id),
                  className: "underline underline-offset-4",
                  onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                    event.stopPropagation(),
                },
                `#${id}`,
              );
        },
      },
      { key: "notes", type: "markdown", label: t("fleet.lifecycle.notes") },
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
      "vehicle_id",
      "inspector_name",
      "outcome",
      "notes",
    ],
    columns: [
      { key: "vehicle_name", label: t("fleet.lifecycle.vehicle") },
      { key: "inspector_name", label: t("fleet.lifecycle.inspector") },
      {
        key: "inspected_at",
        label: t("fleet.lifecycle.inspectedAt"),
        type: "datetime",
      },
      { key: "outcome", label: t("fleet.lifecycle.outcome"), type: "badge" },
      { key: "odometer_km", label: t("fleet.table.odometer"), type: "number" },
      { key: "notes", type: "markdown", label: t("fleet.lifecycle.notes") },
    ],
    emptyMessage: t("fleet.lifecycle.inspections.empty"),
  },
});
