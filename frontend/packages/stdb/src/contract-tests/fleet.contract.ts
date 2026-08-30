/**
 * Compile-only — Fleet BFF reducer keys stay aligned with command metadata.
 */
import {
  FLEET_BFF_REDUCERS,
  fleetCommandContract,
} from "../commands/fleet-http";

for (const k of FLEET_BFF_REDUCERS) {
  void fleetCommandContract(k);
}
