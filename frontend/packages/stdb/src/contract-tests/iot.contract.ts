/**
 * Compile-only — IoT BFF reducer keys stay aligned with `iotBffCallUrl`.
 */
import {
  IOT_BFF_REDUCERS,
  iotBffCallUrl,
  iotCommandContract,
} from "../commands/iot-http";

for (const k of IOT_BFF_REDUCERS) {
  void iotBffCallUrl(k);
  void iotCommandContract(k);
}
