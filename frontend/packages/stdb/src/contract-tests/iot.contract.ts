/**
 * Compile-only — IoT BFF reducer keys stay aligned with command metadata.
 */
import {
  IOT_BFF_REDUCERS,
  iotCommandContract,
} from "../commands/iot-http";

for (const k of IOT_BFF_REDUCERS) {
  void iotCommandContract(k);
}
