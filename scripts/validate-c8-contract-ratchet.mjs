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

console.log(`[c8-contract-ratchet] OK — ${Object.keys(registry).length} resources and ${subscriptionResources.length} subscriptions guarded`);
