/**
 * Compile-only — Calendar BFF reducer keys stay aligned with `calendarBffCallUrl`.
 */
import {
  CALENDAR_BFF_REDUCERS,
  calendarBffCallUrl,
  calendarCommandContract,
} from "../commands/calendar-http";

for (const k of CALENDAR_BFF_REDUCERS) {
  void calendarBffCallUrl(k);
  void calendarCommandContract(k);
}
