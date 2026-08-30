/**
 * Compile-only — Inventory BFF reducer keys stay aligned with command metadata.
 */
import {
  INVENTORY_BFF_REDUCERS,
  inventoryCommandContract,
} from "../commands/inventory-http";

for (const k of INVENTORY_BFF_REDUCERS) {
  void inventoryCommandContract(k);
}
