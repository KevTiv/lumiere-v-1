/**
 * Compile-only — Inventory BFF reducer keys stay aligned with `inventoryBffCallUrl`.
 */
import {
  INVENTORY_BFF_REDUCERS,
  inventoryBffCallUrl,
  inventoryCommandContract,
} from "../commands/inventory-http";

for (const k of INVENTORY_BFF_REDUCERS) {
  void inventoryBffCallUrl(k);
  void inventoryCommandContract(k);
}
