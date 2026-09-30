#!/usr/bin/env python3
"""Read-only AG-09 verifier after a disposable, frozen-source C7 drill.

Uses fixed loopback fixture modules, complete rows, resume/repeat watermark
evidence and externally captured provider-dispatch counters. Does not restore,
start a gateway, dispatch a provider request, or generate acceptance evidence.
"""
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

SOURCE = "lumiere-c7-ai-source"
TARGET = "lumiere-c7-ai-target"
TABLES = (
    "ai_agent_run", "ai_agent_run_step", "ai_price_snapshot", "ai_spend_budget",
    "ai_spend_reservation", "ai_provider_attempt", "ai_action_draft",
    "ai_action_draft_request", "ai_capability_execution",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def option(value):
    if isinstance(value, dict) and set(value) == {"some"}:
        return value["some"]
    if isinstance(value, dict) and set(value) == {"none"}:
        return None
    return value


def integer(value):
    return type(value) is int and value >= 0


def verify_reports(coverage, resume, repeat, dispatch):
    organization_id = coverage.get("organization_id")
    require(integer(organization_id) and organization_id > 0, "invalid evidence organization")
    watermark = coverage.get("watermark", {})
    require(integer(watermark.get("sequence")) and watermark["sequence"] > 0
            and re.fullmatch(r"[0-9a-f]{64}", watermark.get("commit_checksum", "")),
            "invalid source watermark")
    for report in (resume, repeat):
        require(report.get("verified") is True and report.get("organization_id") == organization_id
                and report.get("watermark") == watermark, "verified resume/repeat at the source watermark required")
    require(dispatch.get("observation_complete") is True and dispatch.get("organization_id") == organization_id
            and dispatch.get("source_module") == SOURCE and dispatch.get("target_module") == TARGET
            and dispatch.get("watermark") == watermark, "scoped provider observation evidence required")
    require(integer(dispatch.get("before")) and integer(dispatch.get("after"))
            and dispatch["before"] == dispatch["after"], "provider redispatch observed or counters missing")
    return organization_id, watermark


def verify_snapshots(source, target, organization_id):
    """Fail on a vacuous fixture, foreign restore, missing row or broken binding."""
    own = {}
    tables = {}
    foreign = 0
    for table in TABLES:
        require(table in source and table in target, f"{table}: snapshot missing")
        scoped = [row for row in source[table] if row["organization_id"] == organization_id]
        foreign += sum(row["organization_id"] != organization_id for row in source[table])
        require(scoped, f"{table}: source fixture must be nonempty")
        require(all(row["organization_id"] == organization_id for row in target[table]), f"{table}: foreign restore")
        ids = [row["id"] for row in scoped]
        require(all(integer(row_id) and row_id > 0 for row_id in ids)
                and len(set(ids)) == len(ids), f"{table}: invalid or duplicate source identity")
        scoped = sorted(scoped, key=lambda row: row["id"])
        require(scoped == sorted(target[table], key=lambda row: row["id"]), f"{table}: complete rows differ")
        own[table] = scoped
        tables[table] = {"rows": len(scoped), "complete_rows_sha256": digest(scoped)}
    require(foreign > 0, "foreign source fixture required for tenancy proof")
    runs = {row["id"]: row for row in own["ai_agent_run"]}
    drafts = {row["id"]: row for row in own["ai_action_draft"]}
    reservations = {row["id"]: row for row in own["ai_spend_reservation"]}
    prices = {row["id"]: row for row in own["ai_price_snapshot"]}
    require(any(row["status"] == "running" for row in runs.values()), "active run fixture required")
    require(any(row["status"] == "pending" for row in drafts.values()), "pending draft fixture required")
    require(any(row["status"] == "reserved" and row["reserved_units"] > 0 for row in reservations.values()),
            "outstanding reservation fixture required")
    require(any(row["status"] == "outcome_unknown" for row in own["ai_provider_attempt"]),
            "ambiguous provider attempt fixture required")
    for table in ("ai_agent_run_step", "ai_spend_reservation", "ai_provider_attempt",
                  "ai_action_draft_request", "ai_capability_execution"):
        for row in own[table]:
            run = runs.get(row["run_id"])
            require(run is not None, f"{table}: missing run reference")
            if "company_id" in row:
                require(row["company_id"] == run["company_id"], f"{table}: company binding mismatch")
    request_bindings = set()
    for row in own["ai_action_draft_request"]:
        binding = (row["run_id"], row["request_key"])
        require(binding not in request_bindings, "duplicate draft correlation")
        request_bindings.add(binding)
        draft = drafts.get(row["draft_id"])
        require(draft is not None and draft["company_id"] == row["company_id"]
                and row["draft_id"] in runs[row["run_id"]]["action_draft_ids"], "draft correlation binding mismatch")
    for run in runs.values():
        ids = run["action_draft_ids"]
        require(len(ids) == len(set(ids)) and all(draft_id in drafts
                and drafts[draft_id]["company_id"] == run["company_id"] for draft_id in ids), "run draft ownership mismatch")
        require(set(ids) == {row["draft_id"] for row in own["ai_action_draft_request"] if row["run_id"] == run["id"]},
                "run draft list differs from durable correlations")
    for draft in drafts.values():
        if draft["status"] == "pending":
            require(option(draft["executed_at"]) is None and option(draft["reviewed_by"]) is None,
                    "pending draft already executed or reviewed")
    budgets = {}
    for budget in own["ai_spend_budget"]:
        key = (budget["agent_id"], budget["billing_period"])
        require(key not in budgets, "duplicate agent/period budget")
        budgets[key] = budget
        require(all(integer(budget[field]) for field in ("limit_units", "settled_units", "outstanding_units")),
                "budget amounts must be nonnegative integers")
        require(budget["settled_units"] + budget["outstanding_units"] <= budget["limit_units"], "budget exceeded")
        matching = [row for row in reservations.values() if (row["agent_id"], row["billing_period"]) == key]
        require(sum(row["reserved_units"] for row in matching if row["status"] == "reserved") == budget["outstanding_units"]
                and sum(row["settled_units"] for row in matching if row["status"] == "settled") == budget["settled_units"],
                "budget does not reconcile to reservation rows")
    for reservation in reservations.values():
        budget = budgets.get((reservation["agent_id"], reservation["billing_period"]))
        price = prices.get(reservation["price_snapshot_id"])
        require(budget is not None and price is not None, "reservation budget/price missing")
        require(reservation["agent_id"] == runs[reservation["run_id"]]["agent_id"]
                and reservation["currency"] == budget["currency"]
                and all(reservation[field] == price[field] for field in ("agent_id", "provider", "model", "currency")),
                "reservation agent/price/currency binding mismatch")
        require(reservation["status"] in {"reserved", "settled"}, "unexpected reservation state")
        require(all(integer(reservation[field]) for field in ("reserved_units", "settled_units")),
                "reservation amounts must be nonnegative integers")
    attempt_keys = set()
    for attempt in own["ai_provider_attempt"]:
        reservation = reservations.get(attempt["reservation_id"])
        require(reservation is not None and all(attempt[field] == reservation[field]
                for field in ("company_id", "agent_id", "run_id", "request_key", "provider", "model")),
                "provider attempt binding mismatch")
        require(attempt["request_key"] not in attempt_keys, "duplicate provider attempt")
        attempt_keys.add(attempt["request_key"])
        if attempt["status"] in {"accepted", "dispatched", "outcome_unknown"}:
            require(reservation["status"] == "reserved", "unresolved attempt lost its reservation")
    execution_keys = set()
    require(any(row["status"] == "succeeded" for row in own["ai_capability_execution"])
            and any(row["status"] == "claimed" for row in own["ai_capability_execution"]),
            "both replayable and unresolved execution fixtures required")
    for execution in own["ai_capability_execution"]:
        key = execution["recovery_key"]
        require(key not in execution_keys and re.fullmatch(r"gp03:capability:[0-9a-f]{64}", key),
                "invalid or duplicate execution recovery key")
        execution_keys.add(key)
        require(execution["status"] in {"claimed", "succeeded", "failed"}, "unexpected execution status")
        if execution["status"] == "succeeded":
            output = option(execution["output_json"])
            require(isinstance(output, str) and hashlib.sha256(output.encode()).hexdigest() == option(execution["output_hash"]),
                    "execution output integrity mismatch")
            decoded = json.loads(output)
            require(isinstance(decoded, dict) and isinstance(decoded.get("summary"), str)
                    and decoded["summary"].strip() and "data" in decoded
                    and isinstance(decoded.get("citations"), list), "invalid replayable tool output")
            require(option(execution["failure_reason"]) is None, "succeeded execution has failure reason")
        elif execution["status"] == "claimed":
            require(option(execution["output_json"]) is None and option(execution["output_hash"]) is None,
                    "unresolved execution carries a replayable output")
    return {"tables": tables, "foreign_source_rows_excluded": foreign}


def required(name):
    value = os.environ.get(name, "").strip()
    require(value, f"{name} is required")
    return value


def loopback_host(host):
    parsed = urlsplit(host)
    require(parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
            and not (parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment),
            "STDB_HOST must be a loopback HTTP origin")
    return host


def rows(host, module, token, table):
    require(module in {SOURCE, TARGET} and table in TABLES, "unapproved query scope")
    request = Request(f"{host}/v1/database/{module}/sql", data=f"SELECT * FROM {table} LIMIT 1001".encode(),
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"})
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with build_opener(NoRedirect).open(request, timeout=30) as response:
        payload = response.read(32 * 1024 * 1024 + 1)
        require(len(payload) <= 32 * 1024 * 1024, "SQL response exceeds bounded byte limit")
        result, = json.loads(payload)
    names = [field["name"]["some"] for field in result["schema"]["elements"]]
    require(len(result["rows"]) <= 1000, "fixture exceeds bounded row limit")
    return [dict(zip(names, row, strict=True)) for row in result["rows"]]


def main():
    host = loopback_host(required("STDB_HOST").rstrip("/"))
    evidence = Path(required("C7_EVIDENCE_DIR"))
    reports = [json.loads((evidence / name).read_text())
               for name in ("coverage.json", "resume.json", "repeat.json", "ai-provider-dispatch.json")]
    organization_id, watermark = verify_reports(*reports)
    source_token = required("C7_SOURCE_STDB_TOKEN")
    target_token = required("STDB_RECONSTRUCTION_READ_TOKEN")
    source = {table: rows(host, SOURCE, source_token, table) for table in TABLES}
    target = {table: rows(host, TARGET, target_token, table) for table in TABLES}
    result = verify_snapshots(source, target, organization_id)
    print(json.dumps({"verified": True, "organization_id": organization_id, "watermark": watermark,
                      "provider_dispatch_delta": 0, **result}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        raise SystemExit(f"AG-09 verification failed: {error}") from None
    except (KeyError, TypeError, OSError) as error:
        raise SystemExit(f"AG-09 verification failed: {type(error).__name__}") from None
