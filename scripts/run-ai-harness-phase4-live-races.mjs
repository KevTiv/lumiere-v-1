#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moduleName = process.env.STDB_MODULE?.trim();
const host = (process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "");

function requireDisposableTarget() {
  if (process.env.PHASE4_DISPOSABLE_STDB !== "1") {
    throw new Error("PHASE4_DISPOSABLE_STDB=1 is required");
  }
  const parsed = new URL(host);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("STDB_HOST must be a loopback HTTP origin");
  }
  if (
    !moduleName?.startsWith("lumiere-v1-phase4-") &&
    moduleName !== "lumiere-c7-ai-source"
  ) {
    throw new Error(
      "STDB_MODULE must use the disposable lumiere-v1-phase4- prefix or equal lumiere-c7-ai-source",
    );
  }
}

async function spacetime(args) {
  return execFileAsync("spacetime", [...args, "--server", host, "--no-config"], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function sql(statement) {
  const { stdout } = await spacetime(["sql", "--format", "json", moduleName, statement]);
  const payload = JSON.parse(stdout);
  const rows = [];
  for (const result of payload) {
    const names = result.schema.elements.map((field) => field.name.some);
    for (const row of result.rows) {
      rows.push(Object.fromEntries(names.map((name, index) => [name, row[index]])));
    }
  }
  return rows;
}

async function call(reducer, ...args) {
  return spacetime(["call", moduleName, reducer, ...args.map(String)]);
}

function id(value, label) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is not a positive safe integer`);
  }
  return parsed;
}

function quote(value) {
  return value.replaceAll("'", "''");
}

function option(value) {
  if (!Array.isArray(value) || value.length !== 2) return value;
  return value[0] === 0 ? value[1] : undefined;
}

function failureText(result) {
  if (result.status === "fulfilled") return "";
  return `${result.reason?.stderr ?? ""}\n${result.reason?.message ?? result.reason}`;
}

function requireOneWinner(results, expectedLoserPattern, label) {
  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  if (winners.length !== 1 || losers.length !== 1) {
    throw new Error(`${label} expected one success and one rejection`);
  }
  const error = failureText(losers[0]);
  if (!expectedLoserPattern.test(error)) {
    throw new Error(`${label} rejected for an unexpected reason: ${error}`);
  }
}

requireDisposableTarget();

const organizations = await sql("SELECT id FROM organization WHERE code = 'DEMO' LIMIT 1");
const organizationId = id(organizations[0]?.id, "organization id");
const companies = await sql(
  `SELECT id FROM company WHERE organization_id = ${organizationId} LIMIT 1`,
);
const companyId = id(companies[0]?.id, "company id");
const agents = await sql(
  `SELECT id, provider, model FROM ai_agent WHERE organization_id = ${organizationId} AND is_active = true LIMIT 1`,
);
const agentId = id(agents[0]?.id, "agent id");
const provider = String(agents[0]?.provider ?? "");
const model = String(agents[0]?.model ?? "");
if (!provider || !model) throw new Error("active agent has no provider/model binding");
const skills = await sql("SELECT id FROM ai_skill WHERE is_active = true LIMIT 1");
const skillId = id(skills[0]?.id, "skill id");

const tag = `${Date.now()}-${process.pid}`;
const runKey = `phase4-live-race-${tag}`;
await call(
  "create_ai_agent_run",
  organizationId,
  JSON.stringify({
    company_id: companyId,
    skill_id: skillId,
    skill_config_id: { none: [] },
    agent_id: agentId,
    team_member_id: { none: [] },
    run_key: runKey,
    inputs_json: "{}",
    triggered_by_hex: "00".repeat(32),
    metadata: { some: JSON.stringify({ phase4_live_race: tag }) },
  }),
);
const runs = await sql(`SELECT id FROM ai_agent_run WHERE run_key = '${quote(runKey)}' LIMIT 1`);
const runId = id(runs[0]?.id, "run id");

const billingPeriod = new Date().toISOString().slice(0, 7);
const existingBudgets = await sql(
  `SELECT settled_units, outstanding_units FROM ai_spend_budget WHERE organization_id = ${organizationId} AND agent_id = ${agentId} AND billing_period = '${billingPeriod}' LIMIT 1`,
);
const settledBefore = Number(existingBudgets[0]?.settled_units ?? 0);
const outstandingBefore = Number(existingBudgets[0]?.outstanding_units ?? 0);
const limitUnits = settledBefore + outstandingBefore + 100;
await call(
  "configure_ai_spend",
  organizationId,
  agentId,
  JSON.stringify({
    billing_period: billingPeriod,
    currency: "USD",
    limit_units: limitUnits,
    provider,
    model,
    input_units_per_1_k: 1_000,
    output_units_per_1_k: 1_000,
  }),
);
const prices = await sql(
  `SELECT id FROM ai_price_snapshot WHERE organization_id = ${organizationId} AND agent_id = ${agentId}`,
);
const priceSnapshotId = id(
  prices.reduce((latest, row) => Math.max(latest, Number(row.id)), 0),
  "price snapshot id",
);
const reserve = (requestKey) =>
  call(
    "reserve_ai_spend",
    organizationId,
    JSON.stringify({
      company_id: companyId,
      agent_id: agentId,
      run_id: runId,
      request_key: requestKey,
      provider,
      model,
      billing_period: billingPeriod,
      currency: "USD",
      price_snapshot_id: priceSnapshotId,
      input_token_allowance: 0,
      output_token_allowance: 60,
    }),
  );
const requestPrefix = `phase4-race-${tag}`;
const reservationRace = await Promise.allSettled([
  reserve(`${requestPrefix}-a`),
  reserve(`${requestPrefix}-b`),
]);
requireOneWinner(reservationRace, /budget (?:exceeded|exhausted)/i, "AG-06 reservation race");
const budgets = await sql(
  `SELECT limit_units, settled_units, outstanding_units FROM ai_spend_budget WHERE organization_id = ${organizationId} AND agent_id = ${agentId} AND billing_period = '${billingPeriod}' LIMIT 1`,
);
const budget = budgets[0];
if (
  !budget ||
  Number(budget.limit_units) !== limitUnits ||
  Number(budget.settled_units) !== settledBefore ||
  Number(budget.outstanding_units) !== outstandingBefore + 60
) {
  throw new Error(`AG-06 budget invariant failed: ${JSON.stringify(budget)}`);
}
const reservations = await sql(
  `SELECT id FROM ai_spend_reservation WHERE organization_id = ${organizationId} AND run_id = ${runId}`,
);
if (reservations.length !== 1) {
  throw new Error(`AG-06 expected one reservation, found ${reservations.length}`);
}

const recoveryKey = `gp03:capability:${createHash("sha256").update(tag).digest("hex")}`;
const claimArgs = [
  organizationId,
  JSON.stringify({
    company_id: companyId,
    run_id: runId,
    recovery_key: recoveryKey,
    capability: "phase4.live_race",
  }),
];
const claimRace = await Promise.allSettled([
  call("claim_ai_capability_execution", ...claimArgs),
  call("claim_ai_capability_execution", ...claimArgs),
]);
requireOneWinner(claimRace, /already claimed/i, "AG-08 capability claim race");
const claimed = await sql(
  `SELECT status FROM ai_capability_execution WHERE organization_id = ${organizationId} AND recovery_key = '${recoveryKey}'`,
);
if (claimed.length !== 1 || claimed[0].status !== "claimed") {
  throw new Error(`AG-08 exclusive claim invariant failed: ${JSON.stringify(claimed)}`);
}

const outputJson = JSON.stringify({ summary: "phase4 live race", data: {}, citations: [] });
const outputHash = createHash("sha256").update(outputJson).digest("hex");
await call(
  "record_ai_capability_execution_result",
  organizationId,
  JSON.stringify({
    recovery_key: recoveryKey,
    status: "succeeded",
    output_json: { some: outputJson },
    output_hash: { some: outputHash },
    failure_reason: { none: [] },
  }),
);
const replay = await Promise.allSettled([call("claim_ai_capability_execution", ...claimArgs)]);
if (replay[0].status !== "rejected" || !/already claimed/i.test(failureText(replay[0]))) {
  throw new Error("AG-08 terminal reconnect unexpectedly reacquired the capability claim");
}
const terminal = await sql(
  `SELECT status, output_hash FROM ai_capability_execution WHERE organization_id = ${organizationId} AND recovery_key = '${recoveryKey}'`,
);
if (
  terminal.length !== 1 ||
  terminal[0].status !== "succeeded" ||
  option(terminal[0].output_hash) !== outputHash
) {
  throw new Error(`AG-08 terminal result invariant failed: ${JSON.stringify(terminal)}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      verified: true,
      module: moduleName,
      organization_id: organizationId,
      company_id: companyId,
      run_id: runId,
      ag06: {
        concurrent_clients: 2,
        winners: 1,
        outstanding_units_before: outstandingBefore,
        outstanding_units_after: outstandingBefore + 60,
        limit_units: limitUnits,
      },
      ag08: { concurrent_clients: 2, claim_rows: 1, terminal_status: "succeeded", reconnect_rejected: true },
    },
    null,
    2,
  )}\n`,
);
