#!/usr/bin/env node
/**
 * CI guard: every org-scoped subscription resource must declare organization_id
 * (or company_id for company-scoped tables) in resource_registry mandatory fields.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registryPath = path.join(
  __dirname,
  "../crates/stdb-auth/assets/resource_registry.json",
);
const subscriptionKeysPath = path.join(
  __dirname,
  "../crates/stdb-auth/assets/subscription-resource-keys.json",
);

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const subscriptionKeys = JSON.parse(readFileSync(subscriptionKeysPath, "utf8"));

const companyScopedOnly = new Set([
  "intercompany-rules",
  "intercompany-transactions",
  "fixed-assets",
  "depreciation-lines",
  "account-assets",
  "picking-batches",
  "delivery-carriers",
  "delivery-price-rules",
  "shipping-methods",
  "pos-payment-methods",
  "pos-configs",
  "pos-sessions",
  "consolidation-accounts",
  "consolidation-journals",
  "consolidation-elimination-entries",
  "fiscal-years",
  "account-periods",
  "iot-pairing-tokens",
  "ai-insights",
  "ai-document-processing-jobs",
]);

const authKeys = new Set([
  "auth",
  "user-profile",
  "user-role-assignment",
  "auth-role-table",
  "user-organization",
  "casbin-rule",
  "org-permissions",
  "policy-snapshots",
]);

const globalKeys = new Set(["user-profile", "casbin-rule"]);

let failed = false;

for (const key of subscriptionKeys) {
  if (authKeys.has(key) && key !== "user-organization" && key !== "roles" && key !== "user-roles") {
    continue;
  }
  const entry = registry[key];
  if (!entry) {
    console.error(`[subscription-guard] missing registry entry for ${key}`);
    failed = true;
    continue;
  }
  const mandatory = entry.mandatory ?? [];
  if (globalKeys.has(key)) {
    continue;
  }
  if (companyScopedOnly.has(key)) {
    const ok =
      mandatory.includes("company_id") ||
      mandatory.includes("origin_company_id") ||
      mandatory.includes("source_company_id") ||
      mandatory.includes("asset_id");
    if (!ok) {
      console.error(
        `[subscription-guard] ${key} must mandate company scope in resource_registry`,
      );
      failed = true;
    }
    continue;
  }
  if (!mandatory.includes("organization_id")) {
    console.error(
      `[subscription-guard] ${key} must mandate organization_id in resource_registry`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `[subscription-guard] OK — ${subscriptionKeys.length} subscription resources checked`,
);
