#!/usr/bin/env node
/**
 * Generates and validates the SQ-0 subscription census.
 *
 * The TypeScript compatibility registry is authoritative until SQ-1 moves
 * subscription semantics into generated IR. Rust lists are intentionally
 * reported as compatibility views; they are not silently treated as the
 * source of truth.
 *
 * Usage:
 *   node scripts/generate-subscription-census.mjs --write
 *   node scripts/generate-subscription-census.mjs --check
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const tsRegistryPath = path.join(
  root,
  "frontend/packages/stdb/src/queries/erp-subscriptions.ts",
);
const censusPath = path.join(
  root,
  "crates/stdb-auth/assets/subscription-census.json",
);
const rustKeysPath = path.join(
  root,
  "crates/stdb-auth/assets/subscription-resource-keys.json",
);
const rustFullPath = path.join(
  root,
  "crates/stdb-auth/assets/full-client-subscription-resources.json",
);
const resourceRegistryPath = path.join(
  root,
  "crates/stdb-auth/assets/resource_registry.json",
);
const rowTypePath = path.join(
  root,
  "crates/stdb-auth/assets/query-resource-row-type.json",
);

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

function readTypescriptSubscriptionKeys() {
  const source = readFileSync(tsRegistryPath, "utf8");
  const match = source.match(
    /export const SUBSCRIPTION_RESOURCE_KEYS = \[(.*?)\n\] as const;/s,
  );
  if (!match) throw new Error("cannot locate SUBSCRIPTION_RESOURCE_KEYS");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(([, key]) => key);
}

const COMPANY_SCOPED = new Set([
  "fixed-assets",
  "depreciation-lines",
  "intercompany-rules",
  "intercompany-transactions",
  "fiscal-years",
  "account-periods",
  "consolidation-elimination-entries",
  "consolidation-journals",
  "consolidation-accounts",
  "pos-configs",
  "pos-sessions",
  "pos-payment-methods",
  "picking-batches",
  "delivery-carriers",
  "delivery-price-rules",
  "shipping-methods",
  "ai-document-processing-jobs",
  "ai-insights",
]);

// These tables are company-visible in the current subscription builder even
// when the generated resource registry only carries organization ownership:
// purchasing rows and CRM rows that inherit or optionally carry company
// ownership must not be classified as organization-wide.
const PURCHASING_COMPANY_SCOPED = new Set([
  "purchase-orders",
  "purchase-orders-to-approve",
  "purchase-orders-partial-receipt",
  "purchase-order-lines",
  "purchase-order-lines-over-billed",
  "landed-costs",
  "landed-cost-lines",
  "partner-banks",
  "purchase-requisitions",
  "purchase-requisition-lines",
  "purchase-rfqs",
  "purchase-rfq-lines",
  "purchase-rfq-bids",
  "purchase-returns",
  "purchase-return-lines",
  "purchase-blanket-orders",
  "purchase-blanket-order-lines",
  "purchase-blanket-releases",
  "purchase-contracts",
  "vendor-scorecards",
  "vendor-risk-flags",
  "consignment-agreements",
  "purchase-approval-delegates",
  "commodity-price-indexes",
  "purchasing-integration-intents",
]);

const CRM_OPTIONAL_COMPANY_SCOPED = new Set([
  "contacts",
  "opportunities",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-communication-preferences",
]);

const CRM_REQUIRED_COMPANY_SCOPED = new Set([
  "contact-duplicate-candidates",
  "crm-forecast-snapshots",
]);

const CRM_PARENT_COMPANY_SCOPED = new Set([
  "opportunity-lines",
  "opportunity-presence",
  "contact-tag-assignments",
  "contact-category-assignments",
  "segment-members",
  "contact-relationships",
  "privacy-consent",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
]);

// IoT tables denormalize company ownership from their device/hub parent. The
// current registry is organization-only for most of these, so retain this
// explicit schema-backed exception until ownership metadata is regenerated.
const IOT_COMPANY_SCOPED = new Set([
  "iot-devices",
  "iot-hubs",
  "iot-alerts",
  "iot-actions",
  "iot-telemetry",
  "iot-thresholds",
  "iot-pairing-tokens",
]);

const EXPLICIT_COMPANY_SCOPED = new Set([
  ...COMPANY_SCOPED,
  ...PURCHASING_COMPANY_SCOPED,
  ...CRM_OPTIONAL_COMPANY_SCOPED,
  ...CRM_REQUIRED_COMPANY_SCOPED,
  ...CRM_PARENT_COMPANY_SCOPED,
  ...IOT_COMPANY_SCOPED,
]);

const COMPANY_OWNERSHIP_FIELDS = new Set([
  "company_id",
  "company_ids",
  "source_company_id",
  "destination_company_id",
  "origin_company_id",
]);

const IDENTITY_SCOPED = new Set([
  "user-profile",
  "user-role-assignment",
  "user-organization",
  "user-roles",
  "my-employee",
  "direct-reports",
]);

const PRIVATE_OR_BFF = new Set([
  "partner-banks",
  "landed-cost-lines",
  "my-employee",
  "direct-reports",
  "depreciation-lines",
  "org-permissions",
  "policy-snapshots",
  "leads",
  "lead-sources",
  "lead-lost-reasons",
  "opportunities",
  "opportunity-stages",
  "opportunity-lines",
  "opportunity-presence",
  "contacts",
  "contact-phone-identities",
  "contact-role-assignments",
  "contact-tags",
  "contact-tag-assignments",
  "contact-categories",
  "contact-category-assignments",
  "contact-segments",
  "segment-members",
  "contact-relationships",
  "contact-duplicate-candidates",
  "assignment-rules",
  "activities",
  "utm-campaigns",
  "utm-media",
  "utm-sources",
  "privacy-consent",
  "contact-communication-preferences",
  "crm-forecast-snapshots",
  "lead-scores",
  "lead-score-factors",
  "contact-segment-rules",
  "contact-relationship-insights",
  "crm-conversations",
  "crm-conversation-messages",
]);

const PRESENCE = new Set(["opportunity-presence", "proposal-presence"]);
const HIGH_CHURN = new Set([
  "stock-quants",
  "stock-moves",
  "iot-telemetry",
  "mail-messages",
  "opportunity-presence",
  "proposal-presence",
]);
const QUEUE = /(?:to-approve|to-validate|unbilled|pending|partial-receipt|over-billed|missing-receipt|past-due|due-to-bill|amend-pending|open-qc|short-atp|expired-lots|to-export|exceptions)/;

function consumerEvidence(key, fullKeys) {
  const directory = path.join(root, "frontend/packages/stdb/src/subscriptions");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  const literal = `"${key}"`;
  const evidence = files
    .filter((file) => readFileSync(path.join(directory, file), "utf8").includes(literal))
    .map((file) => `frontend/packages/stdb/src/subscriptions/${file}`);
  const workspaceObserved = evidence.length > 0;
  if (fullKeys.has(key)) evidence.unshift("frontend/web/app/providers.tsx:FULL_CLIENT_SUBSCRIPTION_RESOURCES");
  if (!workspaceObserved) {
    evidence.push("frontend/packages/stdb/src/queries/erp-subscriptions.ts:SUBSCRIPTION_RESOURCE_KEYS");
  }
  return { sources: [...new Set(evidence)], status: workspaceObserved ? "observed" : "pending" };
}

function sourceFor(key, registry, rowTypes) {
  if (key === "auth") {
    return {
      table: "auth-session-bundle",
      readModel: "user_profile + user_role_assignment + role + user_organization + field_permission",
    };
  }
  const table = {
    "auth-role-table": "role",
    "org-permissions": "org_permission",
    "policy-snapshots": "policy_snapshot",
  }[key] ?? registry[key]?.table;
  if (!table) throw new Error(`missing source table for ${key}`);
  return {
    table,
    readModel: rowTypes[key] ?? `bff-authorized:${table}`,
  };
}

function scopeFor(key, registry) {
  if (key === "auth") return "organization+identity";
  if (key === "auth-role-table" || key === "roles") return "global";
  if (key === "my-employee" || key === "direct-reports") return "organization+identity";
  if (IDENTITY_SCOPED.has(key)) return "identity";
  if (EXPLICIT_COMPANY_SCOPED.has(key)) return "organization+company";
  const ownership = new Set([
    ...(registry[key]?.mandatory ?? []),
    ...(registry[key]?.default_restricted ?? []),
  ]);
  if ([...ownership].some((field) => COMPANY_OWNERSHIP_FIELDS.has(field))) return "organization+company";
  return "organization";
}

function predicateClassFor(key) {
  if (PRIVATE_OR_BFF.has(key)) return "authorization-sensitive";
  if (QUEUE.test(key)) return "derived-queue";
  if (key === "employee-documents") return "field-policy-filter";
  return "none";
}

function cardinalityFor(key) {
  if (PRESENCE.has(key)) return "few";
  if (QUEUE.test(key)) return "bounded-set";
  if (["user-profile", "user-role-assignment", "user-organization", "user-roles"].includes(key)) return "few";
  return "broad";
}

function buildCensus() {
  const keys = readTypescriptSubscriptionKeys();
  const registry = readJson(resourceRegistryPath);
  const rowTypes = readJson(rowTypePath);
  const rustKeys = readJson(rustKeysPath);
  const rustFull = readJson(rustFullPath);
  const fullKeys = new Set(rustFull);
  const entries = keys.map((key) => {
    const source = sourceFor(key, registry, rowTypes);
    const bffOnly = PRIVATE_OR_BFF.has(key);
    const cardinality = cardinalityFor(key);
    const fanout = HIGH_CHURN.has(key) ? "high" : cardinality === "bounded-set" ? "low" : "medium";
    const evidence = consumerEvidence(key, fullKeys);
    return {
      resource: key,
      source,
      scope: scopeFor(key, registry),
      deliveryMode: bffOnly ? "bff-only" : "invalidation-only",
      directRowExposure: false,
      fieldSensitivity: registry[key]?.default_restricted?.length ? "field-policy" : bffOnly ? "bff-policy" : "none",
      predicateClass: predicateClassFor(key),
      consumerEvidence: evidence,
      expectedCardinality: cardinality,
      latencyClass: PRESENCE.has(key) ? "presence" : key === "iot-telemetry" ? "background" : "interactive",
      updateFanout: fanout,
      sourceClass: "canonical-table",
      reconnectClass: fullKeys.has(key) ? (fanout === "high" ? "staggered" : "eager") : "on-demand",
      accessPath: {
        status: bffOnly ? "not-applicable" : "pending",
        key: null,
        exception: bffOnly
          ? "Direct realtime exposure is intentionally disabled; use authorized BFF reads."
          : "SQ-0 records the resource shape; SQ-2 must map interactive reads to a shared STDB access path.",
      },
      subscriptionApiAcceptance: {
        required: true,
        status: "not-run",
        method: "live-subscription-api",
        spacetimeSqlStringValidationEquivalent: false,
      },
      rustCompatibility: {
        subscriptionResourceKeys: rustKeys.includes(key),
        fullClientSubscriptionResources: rustFull.includes(key),
      },
      ...(cardinality === "broad"
        ? {
            broadSubscription: {
              approved: false,
              reason: "Broad cardinality is a census classification only; direct realtime exposure remains disabled pending SQ-2/SQ-5 evidence.",
              loadTestOwner: "subscription-query-ir/SQ-5",
            },
          }
        : {}),
    };
  });
  return {
    schemaVersion: 1,
    status: "SQ-0 census foundation; live acceptance/access-path mapping pending",
    authoritativeResourceSet: {
      source: "frontend/packages/stdb/src/queries/erp-subscriptions.ts:SUBSCRIPTION_RESOURCE_KEYS",
      count: keys.length,
    },
    rustCompatibility: {
      subscriptionResourceKeysSource: "crates/stdb-auth/assets/subscription-resource-keys.json",
      fullClientSubscriptionResourcesSource: "crates/stdb-auth/assets/full-client-subscription-resources.json",
      rustOnlySubscriptionResourceKeys: rustKeys.filter((key) => !keys.includes(key)),
      rustOnlyFullClientSubscriptionResources: rustFull.filter((key) => !keys.includes(key)),
      frontendOnlySubscriptionResourceKeys: keys.filter((key) => !rustKeys.includes(key)),
    },
    integrationBoundary: {
      liveSubscriptionApiAcceptanceRequired: true,
      spacetimeSqlStringValidationIsNotEquivalent: true,
      note: "The SQ-0 census records acceptance as pending until subscriptionBuilder().subscribe(...) is exercised against live STDB.",
    },
    entries,
  };
}

function validate(census) {
  const keys = readTypescriptSubscriptionKeys();
  const entries = census.entries;
  const registry = readJson(resourceRegistryPath);
  const rustKeys = readJson(rustKeysPath);
  const rustFull = readJson(rustFullPath);
  const entryKeys = entries.map(({ resource }) => resource);
  const fail = (message) => {
    throw new Error(`[subscription-census] ${message}`);
  };
  if (census.schemaVersion !== 1) fail("unsupported schemaVersion");
  if (census.authoritativeResourceSet.source !== "frontend/packages/stdb/src/queries/erp-subscriptions.ts:SUBSCRIPTION_RESOURCE_KEYS" || census.authoritativeResourceSet.count !== keys.length) fail("authoritative resource-set metadata is stale");
  if (JSON.stringify(entryKeys) !== JSON.stringify(keys)) fail("entries drift from SUBSCRIPTION_RESOURCE_KEYS");
  if (new Set(entryKeys).size !== entryKeys.length) fail("duplicate resource key");
  const specialTables = {
    auth: "auth-session-bundle",
    "auth-role-table": "role",
    "org-permissions": "org_permission",
    "policy-snapshots": "policy_snapshot",
  };
  for (const entry of entries) {
    const expectedTable = specialTables[entry.resource] ?? registry[entry.resource]?.table;
    if (!expectedTable || entry.source.table !== expectedTable) fail(`${entry.resource} source table drift`);
  }
  const expectedRustOnly = rustKeys.filter((key) => !keys.includes(key));
  const expectedRustFullOnly = rustFull.filter((key) => !keys.includes(key));
  const expectedFrontendOnly = keys.filter((key) => !rustKeys.includes(key));
  if (JSON.stringify(census.rustCompatibility.rustOnlySubscriptionResourceKeys) !== JSON.stringify(expectedRustOnly) || JSON.stringify(census.rustCompatibility.rustOnlyFullClientSubscriptionResources) !== JSON.stringify(expectedRustFullOnly) || JSON.stringify(census.rustCompatibility.frontendOnlySubscriptionResourceKeys) !== JSON.stringify(expectedFrontendOnly)) fail("Rust compatibility drift metadata is stale");
  if (!census.integrationBoundary.liveSubscriptionApiAcceptanceRequired || !census.integrationBoundary.spacetimeSqlStringValidationIsNotEquivalent) {
    fail("live subscription API boundary is missing or unsafe");
  }
  const scopes = new Set(["global", "organization", "company", "identity", "organization+identity", "organization+company"]);
  const deliveries = new Set(["invalidation-only", "direct-row", "bff-only"]);
  const sensitivities = new Set(["none", "field-policy", "bff-policy"]);
  const predicates = new Set(["none", "derived-queue", "field-policy-filter", "authorization-sensitive"]);
  const cardinalities = new Set(["one", "few", "bounded-page", "bounded-set", "broad"]);
  const fanouts = new Set(["low", "medium", "high"]);
  const latencies = new Set(["interactive", "background", "presence"]);
  const reconnects = new Set(["eager", "staggered", "on-demand"]);
  const accessStatuses = new Set(["approved", "pending", "not-applicable", "exception"]);
  const evidenceStatuses = new Set(["observed", "pending"]);
  const sourceClasses = new Set(["canonical-table", "hot-projection"]);
  const representativeScopes = {
    "purchase-orders": "organization+company",
    "purchase-order-lines": "organization+company",
    "stock-quants": "organization+company",
    "stock-moves": "organization+company",
    "iot-devices": "organization+company",
    "iot-telemetry": "organization+company",
    contacts: "organization+company",
    "opportunity-lines": "organization+company",
    "landed-cost-lines": "organization+company",
    "my-employee": "organization+identity",
    "direct-reports": "organization+identity",
  };
  for (const [resource, expectedScope] of Object.entries(representativeScopes)) {
    const entry = entries.find((candidate) => candidate.resource === resource);
    if (!entry || entry.scope !== expectedScope) fail(`${resource} semantic scope regressed to ${entry?.scope ?? "missing"}`);
  }
  for (const entry of entries) {
    for (const field of ["source", "scope", "deliveryMode", "fieldSensitivity", "predicateClass", "consumerEvidence", "expectedCardinality", "latencyClass", "updateFanout", "sourceClass", "reconnectClass", "accessPath", "subscriptionApiAcceptance", "rustCompatibility"]) {
      if (entry[field] === undefined || entry[field] === null) fail(`${entry.resource} is missing ${field}`);
    }
    if (!entry.source.table || !entry.source.readModel) fail(`${entry.resource} has incomplete source metadata`);
    if (!scopes.has(entry.scope)) fail(`${entry.resource} has unsafe scope`);
    if (!deliveries.has(entry.deliveryMode)) fail(`${entry.resource} has unsafe deliveryMode`);
    if (entry.deliveryMode === "direct-row" || entry.directRowExposure !== false) fail(`${entry.resource} enables forbidden direct-row exposure`);
    if (!sensitivities.has(entry.fieldSensitivity) || !predicates.has(entry.predicateClass)) fail(`${entry.resource} has unknown sensitivity/predicate class`);
    if (!Array.isArray(entry.consumerEvidence.sources) || entry.consumerEvidence.sources.length === 0 || !evidenceStatuses.has(entry.consumerEvidence.status)) fail(`${entry.resource} has incomplete consumer evidence status`);
    if (!cardinalities.has(entry.expectedCardinality) || !fanouts.has(entry.updateFanout) || !latencies.has(entry.latencyClass) || !reconnects.has(entry.reconnectClass) || !sourceClasses.has(entry.sourceClass)) fail(`${entry.resource} has invalid performance metadata`);
    if (!entry.accessPath.exception || !accessStatuses.has(entry.accessPath.status)) fail(`${entry.resource} has incomplete access-path status/exception`);
    if (entry.subscriptionApiAcceptance.required !== true || entry.subscriptionApiAcceptance.method !== "live-subscription-api" || entry.subscriptionApiAcceptance.spacetimeSqlStringValidationEquivalent !== false) fail(`${entry.resource} weakens the live subscription API regression boundary`);
    if (entry.expectedCardinality === "broad" && (!entry.broadSubscription || entry.broadSubscription.approved !== false || !entry.broadSubscription.reason || !entry.broadSubscription.loadTestOwner)) fail(`${entry.resource} has unowned broad-subscription classification`);
    if (entry.rustCompatibility.subscriptionResourceKeys !== rustKeys.includes(entry.resource) || entry.rustCompatibility.fullClientSubscriptionResources !== rustFull.includes(entry.resource)) fail(`${entry.resource} Rust compatibility metadata is stale`);
  }
}

const expected = buildCensus();
const mode = process.argv[2] ?? "--check";
if (mode === "--write") {
  writeFileSync(censusPath, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`[subscription-census] wrote ${expected.entries.length} entries`);
} else if (mode !== "--check") {
  throw new Error("usage: --write or --check");
}
const actual = readJson(censusPath);
validate(actual);
if (mode === "--check" && JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error("census is stale; run with --write and review the generated diff");
}
console.log(`[subscription-census] OK — ${actual.entries.length} entries; live API acceptance remains required`);
