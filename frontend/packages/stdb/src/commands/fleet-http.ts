import { stringifyReducerCallBody } from "@lumiere/api-client";

import type { ReducerCommandContractMeta } from "./types";

/**
 * Fleet mutations via Next.js BFF `POST /api/call/:reducer`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` fleet hooks.
 */
export const FLEET_BFF_REDUCERS = [
  "create_fleet_vehicle",
  "update_vehicle_position",
] as const;

export type FleetBffReducerKey = (typeof FLEET_BFF_REDUCERS)[number];

const WITH_COMPANY_QUERY = new Set<FleetBffReducerKey>();

/** Same-origin path used by `apiFetch` in the web app. */
export function fleetBffCallUrl(reducer: FleetBffReducerKey): string {
  const base = `/api/call/${reducer}`;
  return WITH_COMPANY_QUERY.has(reducer) ? `${base}?withCompany=true` : base;
}

export function fleetBffPost(
  reducer: FleetBffReducerKey,
  args: unknown[],
): { urlPath: string; init: RequestInit } {
  return {
    urlPath: fleetBffCallUrl(reducer),
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyReducerCallBody(args),
    },
  };
}

/** Subscription resource keys whose mirrors should reflect fleet reducer effects. */
export const FLEET_COMMAND_SUBSCRIPTION_HINTS: Record<
  FleetBffReducerKey,
  readonly string[]
> = {
  create_fleet_vehicle: ["fleet-vehicles"],
  update_vehicle_position: ["fleet-vehicles"],
};

export function fleetCommandContract(
  reducer: FleetBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Fleet reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: FLEET_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization + company scope; trailing args must match CreateFleetVehicleParams / UpdateVehiclePositionParams (see stringifyReducerCallBody).",
  };
}
