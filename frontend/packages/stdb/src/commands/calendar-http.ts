
import type { ReducerCommandContractMeta } from "./types";

/**
 * Calendar mutations via Next.js BFF `POST /api/operations/:operation`.
 * Keys match SpacetimeDB reducer snake_case names used by `@lumiere/query-hooks` calendar hooks.
 */
export const CALENDAR_BFF_REDUCERS = [
  "create_calendar_event",
  "delete_calendar_event",
  "update_calendar_event",
] as const;

export type CalendarBffReducerKey = (typeof CALENDAR_BFF_REDUCERS)[number];

/** Subscription resource keys whose mirrors should reflect calendar reducer effects. */
export const CALENDAR_COMMAND_SUBSCRIPTION_HINTS: Record<
  CalendarBffReducerKey,
  readonly string[]
> = {
  create_calendar_event: ["calendar-events"],
  delete_calendar_event: ["calendar-events"],
  update_calendar_event: ["calendar-events"],
};

export function calendarCommandContract(
  reducer: CalendarBffReducerKey,
): ReducerCommandContractMeta {
  return {
    reducerName: reducer,
    description: `Calendar reducer ${reducer} (HTTP BFF).`,
    requiredSubscriptionResources: CALENDAR_COMMAND_SUBSCRIPTION_HINTS[reducer],
    affectedTables: [],
    expectations:
      "Authenticated api-server session with organization scope; args must match SpacetimeDB u64 JSON rules (see stringifyReducerCallBody).",
  };
}
