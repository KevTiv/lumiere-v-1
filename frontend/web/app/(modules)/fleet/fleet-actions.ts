"use client";

import { useEffect, useRef, useState } from "react";
import { useErpSession } from "@lumiere/erp-session";
import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import { useRBAC } from "@lumiere/ui/lib/rbac-context";
import {
  useCreateFleetVehicle,
  useRecordFleetInspection,
  useRecordFleetService,
  useUpdateFleetVehicleDriver,
  type FleetInspectionOutcome,
} from "@lumiere/query-hooks/hooks/fleet";
import {
  fleetFailureIsDefinitive,
  fleetRequestStorageKey,
  prepareFleetHistoryAttempt,
  readFleetHistoryAttempt,
  type FleetHistoryAttempt,
  type FleetRequestScope,
} from "./fleet-request";

type FormData = Record<string, unknown>;

export type FleetAction =
  | "createFleetVehicle"
  | "assignFleetDriver"
  | "recordFleetService"
  | "recordFleetInspection";

function isFleetAction(value: string): value is FleetAction {
  return [
    "createFleetVehicle",
    "assignFleetDriver",
    "recordFleetService",
    "recordFleetInspection",
  ].includes(value);
}

const optionalDate = (value: unknown) => {
  if (value == null || String(value).trim() === "") return undefined;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid date.");
  return parsed;
};

const optionalNumber = (value: unknown) => {
  if (value == null || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error("Enter a valid number of zero or more.");
  return parsed;
};

const optionalText = (value: unknown) =>
  value != null && String(value).trim() !== "" ? String(value).trim() : null;

const requiredId = (value: unknown) => {
  const id = parseStrictU64(value);
  if (id == null || id <= 0n) throw new Error("Select a valid record.");
  return id;
};

const inspectionOutcome = (value: unknown): FleetInspectionOutcome => {
  if (
    value === "passed" ||
    value === "failed" ||
    value === "attention_required"
  )
    return value;
  throw new Error("Select an inspection outcome.");
};

/** Fleet list and record forms share one operation owner and one recoverable request per actor/company. */
export function useFleetActions(
  orgId: bigint,
  companyId: bigint | undefined,
  employeeIds: readonly string[] = [],
) {
  const { identity, organizationId: sessionOrgId } = useErpSession();
  const { checkPermission, permissionsReady } = useRBAC();
  const createVehicle = useCreateFleetVehicle(orgId, companyId);
  const updateDriver = useUpdateFleetVehicleDriver(orgId, companyId);
  const recordService = useRecordFleetService(orgId, companyId);
  const recordInspection = useRecordFleetInspection(orgId, companyId);
  const scope: FleetRequestScope | null =
    identity &&
    companyId != null &&
    companyId > 0n &&
    orgId > 0n &&
    String(sessionOrgId) === String(orgId)
      ? {
          actorIdentity: identity,
          organizationId: String(orgId),
          companyId: String(companyId),
        }
      : null;
  const scopeKey = scope ? fleetRequestStorageKey(scope) : null;
  const live = useRef({
    scopeKey,
    checkPermission,
    permissionsReady,
    employeeIds,
  });
  live.current = { scopeKey, checkPermission, permissionsReady, employeeIds };
  const busy = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<FleetHistoryAttempt | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recovery =
    attempt && fleetRequestStorageKey(attempt.scope) === scopeKey
      ? attempt
      : null;

  useEffect(() => {
    if (!scope || !scopeKey) return;
    live.current.scopeKey = scopeKey;
    const refresh = () => {
      try {
        setAttempt(
          readFleetHistoryAttempt(window.localStorage.getItem(scopeKey), scope),
        );
        setRecoveryError(null);
      } catch (error) {
        setRecoveryError(
          error instanceof Error ? error.message : String(error),
        );
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      if (live.current.scopeKey === scopeKey) live.current.scopeKey = null;
    };
    // The key contains every immutable scope field.
  }, [scopeKey]);

  const submit = async (action: string, formData: FormData): Promise<void> => {
    if (!isFleetAction(action)) {
      throw new Error(`Unsupported fleet action: ${action}`);
    }
    const assertScope = () => {
      if (!scope || !scopeKey || live.current.scopeKey !== scopeKey) {
        throw new Error(
          "Select the original company and signed-in account before saving.",
        );
      }
      const permission = action === "createFleetVehicle" ? "create" : "write";
      if (
        live.current.permissionsReady === false ||
        !live.current.checkPermission("fleet_vehicle", permission).allowed
      ) {
        throw new Error(
          "You do not have permission to change this fleet record.",
        );
      }
      const employee =
        action === "assignFleetDriver"
          ? formData.driver_id === "unassigned"
            ? null
            : requiredId(formData.driver_id)
          : action === "recordFleetInspection" &&
              optionalText(formData.inspector_id) &&
              formData.inspector_id !== "none"
            ? requiredId(formData.inspector_id)
            : null;
      if (
        employee != null &&
        !live.current.employeeIds.includes(String(employee))
      ) {
        throw new Error(
          "Employee choices are unavailable or have changed. Choose an available employee, unassign the driver, or record the inspection without an inspector.",
        );
      }
    };
    assertScope();
    if (busy.current) throw new Error("A fleet save is already in progress.");
    busy.current = true;
    setIsSubmitting(true);
    try {
      if (action === "createFleetVehicle") {
        const name = String(formData.name ?? "").trim();
        const vehicleType = String(formData.vehicle_type ?? "").trim();
        if (!name || !vehicleType)
          throw new Error("Enter a vehicle name and type.");
        await createVehicle.mutateAsync({
          name,
          vehicleType,
          licensePlate: optionalText(formData.license_plate),
          driverName: optionalText(formData.driver_name),
        });
      } else if (action === "assignFleetDriver") {
        await updateDriver.mutateAsync({
          vehicleId: requiredId(formData.vehicle_id),
          driverId:
            formData.driver_id === "unassigned"
              ? null
              : requiredId(formData.driver_id),
        });
      } else {
        // Validate before persisting: invalid input never leaves an unresolved attempt.
        const input =
          action === "recordFleetService"
            ? {
                vehicleId: requiredId(formData.vehicle_id),
                serviceTypeId: requiredId(formData.service_type_id),
                servicedAt: optionalDate(formData.serviced_at),
                odometerKm: optionalNumber(formData.odometer_km),
                provider: String(formData.provider ?? "").trim(),
                notes: String(formData.notes ?? "").trim(),
                costAmount: optionalNumber(formData.cost_amount),
                journalId: requiredId(formData.journal_id),
                expenseAccountId: requiredId(formData.expense_account_id),
                offsetAccountId: requiredId(formData.offset_account_id),
              }
            : {
                vehicleId: requiredId(formData.vehicle_id),
                inspectorId:
                  optionalText(formData.inspector_id) &&
                  formData.inspector_id !== "none"
                    ? requiredId(formData.inspector_id)
                    : undefined,
                inspectedAt: optionalDate(formData.inspected_at),
                outcome: inspectionOutcome(formData.outcome),
                odometerKm: optionalNumber(formData.odometer_km),
                notes: String(formData.notes ?? "").trim(),
              };
        if (
          "costAmount" in input &&
          (input.costAmount == null || input.costAmount <= 0)
        ) {
          throw new Error("Enter a service cost greater than zero.");
        }
        const run = async () => {
          assertScope();
          const key = scopeKey!;
          const previous = readFleetHistoryAttempt(
            window.localStorage.getItem(key),
            scope!,
          );
          const prepared = prepareFleetHistoryAttempt(
            previous,
            scope!,
            action,
            formData,
            () => crypto.randomUUID(),
          );
          // Recovery must survive reload before any command can be dispatched.
          window.localStorage.setItem(key, JSON.stringify(prepared));
          setAttempt(prepared);
          setRecoveryError(null);
          try {
            if (input.serviceTypeId !== undefined) {
              await recordService.mutateAsync({
                ...input,
                clientRequestId: prepared.clientRequestId,
                assertScope,
              });
            } else {
              await recordInspection.mutateAsync({
                ...input,
                clientRequestId: prepared.clientRequestId,
                assertScope,
              });
            }
            window.localStorage.removeItem(key);
            if (live.current.scopeKey === key) setAttempt(null);
          } catch (error) {
            if (fleetFailureIsDefinitive(error, previous != null)) {
              window.localStorage.removeItem(key);
              if (live.current.scopeKey === key) setAttempt(null);
            } else if (live.current.scopeKey === key) {
              setRecoveryError(
                "The save result is not confirmed. Retry the saved request to check its exact result.",
              );
            }
            throw error;
          }
        };
        // Current browsers coordinate the same actor/company across tabs, as well as this hook's same-tab guard.
        if (typeof navigator !== "undefined" && navigator.locks) {
          await navigator.locks.request(scopeKey!, run);
        } else {
          await run();
        }
      }
      assertScope();
    } finally {
      busy.current = false;
      setIsSubmitting(false);
    }
  };

  return {
    submit,
    isPending:
      isSubmitting ||
      createVehicle.isPending ||
      updateDriver.isPending ||
      recordService.isPending ||
      recordInspection.isPending,
    recovery,
    recoveryError: scopeKey ? recoveryError : null,
    canRecover:
      permissionsReady !== false &&
      checkPermission("fleet_vehicle", "write").allowed,
  };
}
