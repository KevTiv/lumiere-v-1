/**
 * Compile-only — Calendar BFF reducer keys stay aligned with command metadata.
 */
import {
  CALENDAR_BFF_REDUCERS,
  calendarCommandContract,
} from "../commands/calendar-http";

for (const k of CALENDAR_BFF_REDUCERS) {
  void calendarCommandContract(k);
}
