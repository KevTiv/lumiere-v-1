import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.config"

// Live ERP acceptance. These cases deliberately share stock fixtures, so run serially.
// The inventory helpers enter the bounded Warehouse workspace; canonical effects
// are still read through the existing authorized query/operation owners.
export default defineConfig(baseConfig, {
  testMatch: [
    "finance-alpha-navigation.spec.ts",
    "cov05b-purchase-receipt.spec.ts",
    "cov05d-purchase-receipt-recovery.spec.ts",
    "cov06-picking-lifecycle.spec.ts",
    "cov06b-picking-backorder.spec.ts",
    "cov06c-internal-quant-transfer.spec.ts",
    "cov06d-cycle-count-adjustment.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
})
