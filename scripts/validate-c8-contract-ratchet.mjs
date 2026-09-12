#!/usr/bin/env node
/** Fail closed when C8 resource contracts regress or subscription SQL escapes compilers. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const readJson = (relative) => JSON.parse(read(relative));
const fail = (message) => { throw new Error(`[c8-contract-ratchet] ${message}`); };

const registry = readJson("crates/stdb-auth/assets/resource_registry.json");
const census = readJson("crates/stdb-auth/assets/subscription-census.json");
const organizationPolicies = readJson("lumiere-codegen/subscription-query-policies.json");
const virtualResources = new Set(["auth", "auth-role-table", "org-permissions", "policy-snapshots"]);
const subscriptionResources = census.entries.map(({ resource }) => resource);
if (new Set(subscriptionResources).size !== subscriptionResources.length) fail("duplicate subscription resource");
for (const resource of subscriptionResources) {
  if (!(resource in registry) && !virtualResources.has(resource)) fail(`unknown subscription resource ${resource}`);
}

const registrySource = read("frontend/packages/stdb/src/queries/erp-subscriptions.ts");
if (!registrySource.includes('from "../generated/subscription-descriptors"')) {
  fail("runtime subscription keys are not imported from generated descriptors");
}
if (/SUBSCRIPTION_RESOURCE_KEYS\s*=\s*\[/.test(registrySource)) {
  fail("handwritten subscription resource registry is forbidden");
}
if (/\bERP_ORG_SQL\b/.test(registrySource)) {
  fail("handwritten organization subscription map is forbidden");
}
if (!registrySource.includes("compileOrganizationSubscription")) {
  fail("runtime does not use the generated organization subscription compiler");
}

if (organizationPolicies.schema_version !== 1) fail("unsupported organization policy schema");
const organizationEntries = Object.entries(organizationPolicies.resources ?? {});
if (organizationEntries.length !== 281) fail("organization subscription policy coverage drift");
const identifier = /^[a-z_][a-z0-9_]*$/;
for (const [resource, descriptor] of organizationEntries) {
  if (registry[resource]?.table !== descriptor.table) fail(`${resource} organization policy table drift`);
  if (!identifier.test(descriptor.table)) fail(`${resource} has an unsafe table identifier`);
  for (const predicate of descriptor.predicates ?? []) {
    if (!identifier.test(predicate.field) || predicate.operator !== "eq") fail(`${resource} has an unsafe predicate`);
    if (typeof predicate.value !== "string" && typeof predicate.value !== "boolean") fail(`${resource} has an unsafe predicate value`);
  }
  for (const order of descriptor.order_by ?? []) {
    if (!identifier.test(order.field) || !["asc", "desc"].includes(order.direction)) fail(`${resource} has unsafe ordering`);
  }
}

const generatedOrganizationSource = read("frontend/packages/stdb/src/generated/org-subscription-descriptors.ts");
const generatedMatch = generatedOrganizationSource.match(
  /ORG_SUBSCRIPTION_QUERY_DESCRIPTORS = (\{[\s\S]*\}) as const;/,
);
if (!generatedMatch) fail("generated organization subscription descriptors are missing");
const generatedOrganizationPolicies = JSON.parse(generatedMatch[1]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(
        ([key, child]) => [key, canonical(child)],
      ),
    );
  }
  return value;
}
if (JSON.stringify(canonical(generatedOrganizationPolicies)) !== JSON.stringify(canonical(organizationPolicies.resources))) {
  fail("generated organization subscription descriptors drift from policy");
}

const sourceRoot = path.join(root, "frontend/packages/stdb/src");
const allowedSqlCompilers = new Set([
  "field-policy.ts",
  "queries/auth.ts",
  "queries/erp-subscriptions.ts",
]);
function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
  });
}
for (const absolute of walk(sourceRoot)) {
  if (!/\.tsx?$/.test(absolute) || absolute.includes(`${path.sep}generated${path.sep}`)) continue;
  const relative = path.relative(sourceRoot, absolute);
  if (/\bSELECT\s+/i.test(readFileSync(absolute, "utf8")) && !allowedSqlCompilers.has(relative)) {
    fail(`raw subscription SQL escaped the approved compiler boundary: ${relative}`);
  }
}

console.log(`[c8-contract-ratchet] OK — ${Object.keys(registry).length} resources, ${subscriptionResources.length} subscriptions, and ${organizationEntries.length} compiled organization policies guarded`);
