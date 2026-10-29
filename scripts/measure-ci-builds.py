#!/usr/bin/env python3
"""Read CI timings/cache evidence without running, cancelling, or modifying CI.

Collect with authenticated `gh` (actions:read), or analyse saved JSON offline.
Only selected cache/build signals are retained from job logs, never raw logs.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import statistics
import subprocess

WORKFLOWS = {"CI", "E2E smoke", "Build Rust runtime image",
             "Build production edge images", "Release contracts"}
LOG_JOBS = {"Rust", "Build exact-commit E2E artifacts", "Build contracts module",
            "Contracts module / Build contracts module", "contracts-module / Build contracts module"}
STEPS = {"Compile E2E module", "Compile and validate E2E API binaries",
         "Compile contracts module", "Typecheck", "Run make e2e-smoke"}
ARTIFACT_CACHE_PREFIXES = ("e2e-wasm-", "e2e-api-", "contracts-module-", "next-compiler-", "e2e-build-")
DEPENDENCY_CACHE_PREFIXES = ("v0-rust-workspace-native-dev-deps-v2-",
                             "v0-rust-workspace-wasm-deps-v2-",
                             "v0-rust-workspace-dev-deps-")
CACHE_PREFIXES = ARTIFACT_CACHE_PREFIXES + DEPENDENCY_CACHE_PREFIXES
NATIVE_API_STEP = "Compile and validate E2E API binaries"
ANSI_ESCAPE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
LOG_LINE = re.compile(r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) (.*)$")
CRATE_COMPILE = re.compile(r"^\s*Compiling ([A-Za-z0-9_-]+) v([0-9][A-Za-z0-9.+-]*)(?: \(([^)]*)\))?\s*$")
CRATE_FRESH = re.compile(r"^\s*Fresh [A-Za-z0-9_-]+ v[0-9][A-Za-z0-9.+-]*(?: \([^)]*\))?\s*$")
CARGO_FINISHED = re.compile(
    r"^\s*Finished (?:`[A-Za-z0-9_-]+` profile|[A-Za-z0-9_-]+) "
    r"\[[^\]\r\n]*\] target\(s\) in (?:\d+(?:\.\d+)?[hms](?:\s+|$))+\s*$")


def seconds(start, end):
    if not start or not end:
        return None
    try:
        value = (datetime.fromisoformat(end.replace("Z", "+00:00")) -
                 datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds()
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def stats(values):
    values = sorted(x for x in values if x is not None)
    if not values:
        return {"n": 0}
    return {"n": len(values), "median_seconds": statistics.median(values),
            "p90_seconds": values[math.ceil(len(values) * .9) - 1],
            "min_seconds": values[0], "max_seconds": values[-1], "sum_seconds": sum(values)}


def cache_key(value, prefixes=CACHE_PREFIXES):
    return bool(isinstance(value, str) and len(value) <= 512
                and value.startswith(prefixes) and re.fullmatch(r"[A-Za-z0-9_.-]+", value))


def filesystem_source(source):
    # Cargo also prints Git source URLs in parentheses. Only filesystem paths
    # identify local crates; neither paths nor URLs are retained in the report.
    return bool(source and (source.startswith(("/", "\\\\", "file://"))
                            or re.match(r"^[A-Za-z]:[\\/]", source)))


def native_api_signals(lines, job):
    step = next((s for s in (job or {}).get("steps", []) if s["name"] == NATIVE_API_STEP), None)
    if step is None:
        return None
    complete = step.get("status") == "completed" and step.get("conclusion") == "success"
    result = {"status": step.get("status"), "conclusion": step.get("conclusion"),
              "complete": complete, "observed": False,
              "third_party_compilations": 0, "local_compilations": 0}
    start, end = step.get("started_at"), step.get("completed_at")
    # The timestamp window binds compiler output to this build rather than to
    # preceding WASM compilation, later tests, or echoed workflow commands.
    if (seconds(start, start) is None
            or (step.get("status") == "completed" and not end)
            or (end and seconds(start, end) is None)
            or step.get("conclusion") == "skipped"):
        return result
    for timestamp, line in lines:
        if not timestamp or seconds(start, timestamp) is None:
            continue
        if end and seconds(timestamp, end) in (None, 0):
            continue
        match = CRATE_COMPILE.fullmatch(line)
        if match:
            result["observed"] = True
            field = "local_compilations" if filesystem_source(match[3]) else "third_party_compilations"
            result[field] += 1
        elif CRATE_FRESH.fullmatch(line) or CARGO_FINISHED.fullmatch(line):
            result["observed"] = True
    return result


def log_signals(log, job=None):
    # Never persist arbitrary log lines or environment dumps. Cache identifiers
    # are constrained to the workflow's known prefixes and inert key alphabet.
    clean_log = ANSI_ESCAPE.sub("", log)
    lines = []
    for line in clean_log.splitlines():
        match = LOG_LINE.fullmatch(line)
        lines.append((match[1], match[2]) if match else (None, line))
    observations, dependencies = [], {}
    active_key, expect_key = None, False
    for _timestamp, line in lines:
        if line == "Cache Key:":
            expect_key = True
            active_key = None
            continue
        if expect_key:
            expect_key = False
            candidate = line.strip()
            if cache_key(candidate, DEPENDENCY_CACHE_PREFIXES):
                active_key = candidate
                dependencies.setdefault(candidate, {"key": candidate, "result": "unknown"})
        restored = re.fullmatch(r'Restored from cache key "([^"]+)" full match: (true|false)\.?', line)
        if restored and active_key and cache_key(restored[1], DEPENDENCY_CACHE_PREFIXES):
            dependencies[active_key].update(
                result="exact" if restored[2] == "true" else "fallback", restored_key=restored[1])
        elif line == "No cache found." and active_key:
            dependencies[active_key]["result"] = "miss"
        for marker in ("Cache not found for input keys: ", "Cache restored from key: ",
                       "Cache saved with key: "):
            if marker not in line:
                continue
            keys = line.split(marker, 1)[1].strip().split(", ")
            keys = [key for key in keys if cache_key(key)]
            if keys:
                observations.append(marker + ", ".join(keys))
    return {"observations": observations,
            "compiled_crates": len(re.findall(r"\bCompiling [A-Za-z0-9_-]+ v", clean_log)),
            "cache_export_seconds": [float(x) for x in re.findall(
                r"(?:preparing build cache for export|sending cache export) ([0-9.]+)s done", clean_log)],
            "rust_dependency_caches": list(dependencies.values()),
            "native_api_compilation": native_api_signals(lines, job)}


def analyse(snapshot, logs, inventory=None):
    groups = defaultdict(list)
    queues = defaultdict(list)
    states = Counter()
    active = []
    step_seconds = {}
    jobs_by_id = {}
    seen = set()
    for sample in snapshot["samples"]:
        run = sample["run"]
        for job in sample["jobs"]:
            # API pagination and repeated snapshots must not double-count jobs.
            if job["id"] in seen:
                continue
            seen.add(job["id"])
            jobs_by_id[job["id"]] = job
            states[job["status"]] += 1
            # A cancelled job can report creation/start times without ever
            # receiving a runner. Require actual setup evidence for queue time.
            setup = any(s["name"] == "Set up job" and s.get("conclusion") == "success"
                        for s in job.get("steps", []))
            if setup:
                queues[run["name"]].append(seconds(job.get("created_at"), job.get("started_at")))
            if job["status"] == "in_progress":
                current = next((s for s in job.get("steps", []) if s["status"] == "in_progress"), {})
                active.append({"run": run["id"], "job": job["id"], "name": job["name"],
                               "step": current.get("name"), "url": job.get("html_url"),
                               "elapsed_seconds": seconds(job.get("started_at"), snapshot["captured_at"])})
            # Completed steps in a running run remain valid observations; only
            # successful completed steps contribute to timing distributions.
            for step in job.get("steps", []):
                if step.get("status") != "completed" or step.get("conclusion") != "success":
                    continue
                duration = seconds(step.get("started_at"), step.get("completed_at"))
                if duration is None:
                    continue
                step_seconds[(job["id"], step["name"])] = duration
                if step["name"] in STEPS or (run["name"] == "Build Rust runtime image"
                                             and step["name"] == "Build and push once"):
                    groups[step["name"]].append(duration)
            if job["name"] == "Build exact-commit E2E artifacts" and job.get("conclusion") == "success":
                groups["E2E artifact job (total)"].append(seconds(job.get("started_at"), job.get("completed_at")))
    caches = defaultdict(lambda: {"misses": 0, "restores": 0, "saves": 0})
    duplicate_keys = defaultdict(list)
    dependency_lookups = defaultdict(lambda: {"exact": 0, "fallback": 0, "miss": 0, "unknown": 0})
    native_reuse = []
    seen_logs = set()
    for entry in logs:
        if entry["job"] not in jobs_by_id:
            continue
        if entry["job"] in seen_logs:
            continue
        seen_logs.add(entry["job"])
        native_dependencies = []
        for dependency in entry.get("rust_dependency_caches", []):
            key = dependency.get("key")
            state = dependency.get("result")
            if (not cache_key(key, DEPENDENCY_CACHE_PREFIXES)
                    or state not in {"exact", "fallback", "miss", "unknown"}):
                continue
            family = next(p for p in DEPENDENCY_CACHE_PREFIXES if key.startswith(p))
            dependency_lookups[family][state] += 1
            # A separate WASM restore is not evidence of native dependency reuse.
            if "workspace-wasm-deps-" not in key:
                native_dependencies.append(dependency)
        native = entry.get("native_api_compilation")
        if native:
            native_reuse.append({"job": entry["job"], "run": entry["run"],
                                 "url": jobs_by_id[entry["job"]].get("html_url"),
                                 "dependency_caches": native_dependencies, **native})
        for observation in entry["observations"]:
            for marker, action in (("Cache not found for input keys: ", "misses"),
                                   ("Cache restored from key: ", "restores"),
                                   ("Cache saved with key: ", "saves")):
                if not observation.startswith(marker):
                    continue
                # Fallback keys are one lookup, not independent cache misses.
                key = observation[len(marker):].split(", ")[0]
                family = next((p for p in CACHE_PREFIXES if key.startswith(p)), None)
                if not family:
                    continue
                caches[family][action] += 1
                compile_step = {"e2e-wasm-": "Compile E2E module", "e2e-api-": "Compile and validate E2E API binaries",
                                "contracts-module-": "Compile contracts module"}.get(family)
                if action == "misses" and compile_step and (entry["job"], compile_step) in step_seconds:
                    duplicate_keys[key].append({"job": entry["job"], "run": entry["run"],
                                                "seconds": step_seconds[(entry["job"], compile_step)]})
    cache_inventory = {"available": bool(inventory and "usage" in inventory)}
    if cache_inventory["available"]:
        by_ref = defaultdict(lambda: {"entries": 0, "bytes": 0})
        for entry in inventory.get("entries", []):
            by_ref[entry["ref"]]["entries"] += 1
            by_ref[entry["ref"]]["bytes"] += entry["size_in_bytes"]
        cache_inventory.update(usage=inventory["usage"], by_ref=dict(by_ref),
                               truncated=inventory.get("truncated", True))
    return {"captured_at": snapshot["captured_at"], "runs": len(snapshot["samples"]),
            "jobs": len(seen), "job_states": dict(states), "active_jobs": active,
            "successful_step_timings": {k: stats(v) for k, v in sorted(groups.items())},
            "runner_queue_timings": {k: stats(v) for k, v in sorted(queues.items())},
            "cache_lookups": dict(caches), "cache_inventory": cache_inventory,
            "rust_dependency_cache_lookups": dict(dependency_lookups),
            "native_api_dependency_reuse": native_reuse,
            "exact_dependency_hits_with_native_recompilation": [row for row in native_reuse
                if row.get("complete") and row.get("observed") and row["third_party_compilations"] > 0
                and any(cache["result"] == "exact" for cache in row["dependency_caches"])],
            "repeated_exact_input_compilations": {k: v for k, v in duplicate_keys.items() if len(v) > 1}}


def markdown(result):
    lines = ["# CI build measurement", "", f"Snapshot: {result['captured_at']} (UTC).",
             f"{result['runs']} sampled runs; {result['jobs']} jobs. Latest attempt per run; bounded sample, not all repository history.", "",
             "Only successful completed steps enter timing statistics. Running jobs are incomplete observations, not zero-duration builds.", "",
             "| Successful work | Samples | Median minutes | P90 minutes | Min–max minutes |", "|---|---:|---:|---:|---:|"]
    for name, value in result["successful_step_timings"].items():
        if value["n"]:
            lines.append(f"| {name} | {value['n']} | {value['median_seconds']/60:.1f} | {value['p90_seconds']/60:.1f} | {value['min_seconds']/60:.1f}–{value['max_seconds']/60:.1f} |")
    lines.extend(["", "Queue time below measures job creation → runner start for jobs with successful setup; it excludes dependency waits before job creation.", "",
                  "| Workflow | Jobs | Median queue minutes | P90 queue minutes | Max queue minutes |", "|---|---:|---:|---:|---:|"])
    for name, value in result["runner_queue_timings"].items():
        if value["n"]:
            lines.append(f"| {name} | {value['n']} | {value['median_seconds']/60:.1f} | {value['p90_seconds']/60:.1f} | {value['max_seconds']/60:.1f} |")
    lines.extend(["", "Cache observations come only from available sampled logs. A successful restore step does not itself prove a hit.", "",
                  "| Cache family | Missed lookups | Restores | Saves |", "|---|---:|---:|---:|"])
    for name, value in sorted(result["cache_lookups"].items()):
        lines.append(f"| {name} | {value['misses']} | {value['restores']} | {value['saves']} |")
    lines.extend(["", "## Rust dependency cache reuse", "",
                  "Exact and fallback hits below prove retrieval only. Native compiler output is measured separately; an exact hit can still lack the dependencies needed by this build.", "",
                  "| Dependency cache family | Exact | Fallback | Miss | Unknown |", "|---|---:|---:|---:|---:|"])
    for name, value in sorted(result.get("rust_dependency_cache_lookups", {}).items()):
        lines.append(f"| {name} | {value['exact']} | {value['fallback']} | {value['miss']} | {value['unknown']} |")
    lines.extend(["", "Native API counts include only timestamped Cargo compilation events within the API compile/validate step. A valid step window without recognized Cargo output remains unobserved. Local paths, raw log lines and environment values are not retained. Cancelled/running steps are incomplete observations.", "",
                  "| Native API job | Step result | Dependency restore | Third-party compilations | Local compilations |", "|---|---|---|---:|---:|"])
    repository = result.get("repository", "KevTiv/lumiere-v-1")
    for row in result.get("native_api_dependency_reuse", []):
        url = f"https://github.com/{repository}/actions/runs/{row['run']}/job/{row['job']}"
        status = row.get("conclusion") or row.get("status") or "unknown"
        if not row.get("complete"):
            status += " (incomplete)"
        restore = ", ".join(sorted({cache["result"] for cache in row["dependency_caches"]})) or "unobserved"
        third_party = row["third_party_compilations"] if row.get("observed") else "unobserved"
        local = row["local_compilations"] if row.get("observed") else "unobserved"
        lines.append(f"| [job {row['job']}]({url}) | {status} | {restore} | {third_party} | {local} |")
    rebuilt = result.get("exact_dependency_hits_with_native_recompilation", [])
    if rebuilt:
        links = ", ".join(f"[job {row['job']}](https://github.com/{repository}/actions/runs/{row['run']}/job/{row['job']})" for row in rebuilt)
        lines.extend(["", f"Completed native builds recompiled third-party crates after an exact dependency-cache restore: {links}. Investigate cache completeness and Cargo fingerprints before treating these restores as avoided compilation."])
    inventory = result["cache_inventory"]
    lines.extend(["", "## Cache inventory", ""])
    if inventory["available"]:
        usage = inventory["usage"]
        lines.append(f"{usage.get('active_caches_count', 'unknown')} active entries; "
                     f"{usage.get('active_caches_size_in_bytes', 0)/1024**3:.2f} GiB total.")
        if inventory["truncated"]:
            lines.append("Per-ref inventory is truncated; sizes below are lower bounds.")
        lines.extend(["", "| Ref | Entries | GiB |", "|---|---:|---:|"])
        for ref, value in sorted(inventory["by_ref"].items(), key=lambda x: -x[1]["bytes"]):
            lines.append(f"| `{ref}` | {value['entries']} | {value['bytes']/1024**3:.2f} |")
    else:
        lines.append("Unavailable in this snapshot. Cache eviction and storage pressure remain unconfirmed.")
    lines.extend(["", "## Repeated exact-input compilation", "",
                  "Matching keys identify reuse opportunities, not guaranteed savings: PR cache scope, creation order, eviction, and toolchains must also be checked.", ""])
    for key, entries in result["repeated_exact_input_compilations"].items():
        minutes = sum(e["seconds"] for e in entries) / 60
        refs = ", ".join(f"[job {e['job']}](https://github.com/{result.get('repository', 'KevTiv/lumiere-v-1')}/actions/runs/{e['run']}/job/{e['job']})" for e in entries)
        lines.append(f"- `{key}`: {len(entries)} compilations, {minutes:.1f} runner-minutes total. {refs}.")
    lines.extend(["", "## Running work at snapshot", ""])
    for job in result["active_jobs"]:
        elapsed = job["elapsed_seconds"]
        age = f"{elapsed/60:.1f} minutes elapsed" if elapsed is not None else "elapsed unknown"
        lines.append(f"- [{job['name']}]({job['url']}): {job['step'] or 'step unavailable'}; {age}.")
    return "\n".join(lines) + "\n"


def api(repository, endpoint):
    return json.loads(subprocess.check_output(["gh", "api", f"repos/{repository}/{endpoint}"], text=True))


def collect_inventory(repository):
    inventory = {"errors": []}
    try:
        inventory["usage"] = api(repository, "actions/cache/usage")
        entries = []
        for page in range(1, 11):
            batch = api(repository, f"actions/caches?per_page=100&page={page}&sort=last_accessed_at&direction=desc")
            entries.extend(batch["actions_caches"])
            if len(entries) >= batch["total_count"] or not batch["actions_caches"]:
                break
        inventory.update(entries=entries, total_count=batch["total_count"], truncated=len(entries) < batch["total_count"])
    except subprocess.CalledProcessError:
        inventory["errors"].append({"error": "cache inventory unavailable; eviction is unconfirmed"})
    return inventory


def collect(repository, limit, log_limit):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("expected owner/repository")
    runs = api(repository, f"actions/runs?per_page={limit}")["workflow_runs"]
    snapshot = {"captured_at": datetime.now(timezone.utc).isoformat(), "repository": repository, "samples": []}
    logs = []
    errors = []
    for run in runs:
        if run["name"] not in WORKFLOWS:
            continue
        # Job timestamps must come from the REST API: some wrappers omit them.
        jobs = []
        page = 1
        while True:
            batch = api(repository, f"actions/runs/{run['id']}/jobs?per_page=100&page={page}")
            jobs.extend(batch["jobs"])
            if len(jobs) >= batch["total_count"] or not batch["jobs"]:
                break
            page += 1
        snapshot["samples"].append({"run": {k: run.get(k) for k in
            ("id", "name", "head_branch", "head_sha", "event", "run_attempt", "status", "conclusion", "created_at", "html_url")},
            "jobs": [{k: job.get(k) for k in ("id", "name", "status", "conclusion", "created_at", "started_at", "completed_at", "html_url", "steps")} for job in jobs]})
        for job in jobs:
            if len(logs) >= log_limit or job["status"] != "completed" or job.get("conclusion") in {"skipped", "neutral"}:
                continue
            if job["name"] not in LOG_JOBS and run["name"] != "Build Rust runtime image":
                continue
            try:
                log = subprocess.check_output(["gh", "api", f"repos/{repository}/actions/jobs/{job['id']}/logs"], text=True, stderr=subprocess.DEVNULL)
                logs.append({"job": job["id"], "run": run["id"], **log_signals(log, job)})
            except subprocess.CalledProcessError:
                errors.append({"job": job["id"], "error": "log unavailable"})
    # Inventory is read-only. Report access failures without losing timings.
    inventory = collect_inventory(repository)
    inventory["errors"].extend(errors)
    # Captured at collection end: queued/running job observations are still not
    # simultaneous, so this timestamp is an upper bound for their elapsed time.
    snapshot["captured_at"] = datetime.now(timezone.utc).isoformat()
    return snapshot, logs, inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default="KevTiv/lumiere-v-1")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--log-limit", type=int, default=30)
    parser.add_argument("--snapshot", type=Path, help="saved snapshot; no network requests")
    parser.add_argument("--cache-observations", type=Path)
    parser.add_argument("--cache-inventory", type=Path)
    parser.add_argument("--inventory-only", action="store_true", help="read cache inventory without scanning runs or logs")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100 or not 0 <= args.log_limit <= 100:
        parser.error("limit must be 1–100 and log-limit 0–100")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        parser.error("expected owner/repository")
    if args.inventory_only:
        snapshot = {"repository": args.repository, "captured_at": datetime.now(timezone.utc).isoformat(), "samples": []}
        logs, inventory = [], collect_inventory(args.repository)
    elif args.snapshot:
        snapshot = json.loads(args.snapshot.read_text())
        logs = json.loads(args.cache_observations.read_text()) if args.cache_observations else []
        inventory = json.loads(args.cache_inventory.read_text()) if args.cache_inventory else None
    else:
        snapshot, logs, inventory = collect(args.repository, args.limit, args.log_limit)
    result = analyse(snapshot, logs, inventory)
    result["repository"] = snapshot["repository"]
    args.output.mkdir(parents=True, exist_ok=True)
    for name, value in (("snapshot.json", snapshot), ("cache-observations.json", logs),
                        ("summary.json", result), ("cache-inventory.json", inventory)):
        (args.output / name).write_text(json.dumps(value, indent=2) + "\n")
    (args.output / "report.md").write_text(markdown(result))
    print(f"Measured {result['runs']} runs and {result['jobs']} jobs; report: {args.output / 'report.md'}")
    if args.inventory_only:
        # Keep inert aggregate/ref sizes visible in job logs as well as the
        # artifact. No raw cache keys, credentials or job logs are printed.
        print(json.dumps(result["cache_inventory"], indent=2))


if __name__ == "__main__":
    main()
