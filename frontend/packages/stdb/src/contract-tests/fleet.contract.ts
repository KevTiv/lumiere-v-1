/**
 * Compile-only — Fleet BFF reducer keys stay aligned with `fleetBffCallUrl`.
 */
import {
  FLEET_BFF_REDUCERS,
  fleetBffCallUrl,
  fleetCommandContract,
} from "../commands/fleet-http";

for (const k of FLEET_BFF_REDUCERS) {
  void fleetBffCallUrl(k);
  void fleetCommandContract(k);
}
