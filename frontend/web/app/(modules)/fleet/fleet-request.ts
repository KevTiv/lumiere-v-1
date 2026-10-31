export type FleetHistoryAction = "recordFleetService" | "recordFleetInspection";

export interface FleetRequestScope {
  organizationId: string;
  companyId: string;
  actorIdentity: string;
}

export interface FleetHistoryAttempt {
  version: 1;
  scope: FleetRequestScope;
  action: FleetHistoryAction;
  clientRequestId: string;
  values: Record<string, string>;
}

const fields: Record<FleetHistoryAction, readonly string[]> = {
  recordFleetService: [
    "vehicle_id",
    "service_type_id",
    "serviced_at",
    "odometer_km",
    "provider",
    "notes",
    "cost_amount",
    "journal_id",
    "expense_account_id",
    "offset_account_id",
  ],
  recordFleetInspection: [
    "vehicle_id",
    "inspector_id",
    "inspected_at",
    "outcome",
    "odometer_km",
    "notes",
  ],
};

export function fleetRequestStorageKey(scope: FleetRequestScope): string {
  return `lumiere:fleet-history:v1:${encodeURIComponent(scope.actorIdentity)}:${scope.organizationId}:${scope.companyId}`;
}

export function fleetRequestValues(
  action: FleetHistoryAction,
  values: FormValues,
): Record<string, string> {
  return Object.fromEntries(
    fields[action].map((field) => [field, String(values[field] ?? "").trim()]),
  );
}

/** An unresolved save retains both its exact payload and identity; changing either is a new effect. */
export function prepareFleetHistoryAttempt(
  previous: FleetHistoryAttempt | null,
  scope: FleetRequestScope,
  action: FleetHistoryAction,
  values: FormValues,
  newRequestId: () => string,
): FleetHistoryAttempt {
  const normalized = fleetRequestValues(action, values);
  if (previous) {
    if (
      fleetRequestStorageKey(previous.scope) !==
        fleetRequestStorageKey(scope) ||
      previous.action !== action ||
      JSON.stringify(previous.values) !== JSON.stringify(normalized)
    ) {
      throw new Error(
        "A fleet save is unresolved. Retry the original saved request before submitting different values.",
      );
    }
    return previous;
  }
  return {
    version: 1,
    scope,
    action,
    values: normalized,
    clientRequestId: newRequestId(),
  };
}

/** Invalid recovery data cannot silently create a replacement request. */
export function readFleetHistoryAttempt(
  raw: string | null,
  scope: FleetRequestScope,
): FleetHistoryAttempt | null {
  if (raw == null) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("action" in value) ||
    (value.action !== "recordFleetService" &&
      value.action !== "recordFleetInspection") ||
    !("clientRequestId" in value) ||
    typeof value.clientRequestId !== "string" ||
    !value.clientRequestId.trim() ||
    !("scope" in value) ||
    !value.scope ||
    typeof value.scope !== "object" ||
    !("organizationId" in value.scope) ||
    value.scope.organizationId !== scope.organizationId ||
    !("companyId" in value.scope) ||
    value.scope.companyId !== scope.companyId ||
    !("actorIdentity" in value.scope) ||
    value.scope.actorIdentity !== scope.actorIdentity ||
    !("values" in value) ||
    !value.values ||
    typeof value.values !== "object" ||
    Array.isArray(value.values)
  ) {
    throw new Error(
      "The saved fleet request is invalid. No new request was sent.",
    );
  }
  const savedValues = value.values as FormValues;
  if (
    Object.keys(savedValues).length !== fields[value.action].length ||
    fields[value.action].some((field) => typeof savedValues[field] !== "string")
  ) {
    throw new Error(
      "The saved fleet request is invalid. No new request was sent.",
    );
  }
  return {
    version: 1,
    scope,
    action: value.action,
    clientRequestId: value.clientRequestId,
    values: fleetRequestValues(value.action, savedValues),
  };
}

/** A rejection of a retry cannot disprove an earlier committed request. */
export function fleetFailureIsDefinitive(
  error: unknown,
  wasRecovery: boolean,
): boolean {
  if (
    wasRecovery ||
    !error ||
    typeof error !== "object" ||
    !("status" in error)
  )
    return false;
  const status = error.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}
import type { FormValues } from "@lumiere/ui/lib/form-types";
