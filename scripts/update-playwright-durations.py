#!/usr/bin/env python3
"""Reviewable baseline update from successful full-suite timing artifacts."""
import argparse
import json
import math
from pathlib import Path
import re


def combine(reports):
    if not reports or any(report.get("version") != 1 or report.get("status") != "passed"
                          or report.get("suite") != "full" for report in reports):
        raise ValueError("only successful full-suite timing reports are accepted")
    commits = {report.get("source_commit") for report in reports}
    if len(commits) != 1 or not next(iter(commits)):
        raise ValueError("reports must describe one source commit")
    partitions = [re.fullmatch(r"([1-9][0-9]*)/([1-9][0-9]*)", report.get("partition", ""))
                  for report in reports]
    if any(partition is None for partition in partitions):
        raise ValueError("reports must identify their partitions")
    totals = {int(partition[2]) for partition in partitions}
    if totals != {len(reports)} or {int(partition[1]) for partition in partitions} != set(range(1, len(reports) + 1)):
        raise ValueError("timing reports must cover one complete partition set")
    files, seen = {}, set()
    for report in reports:
        for test in report["tests"]:
            file = test["file"]
            if test["project"] == "setup":
                continue
            if test["id"] in seen:
                raise ValueError("test appears more than once in timing inputs")
            seen.add(test["id"])
            duration = test["duration_ms"]
            if (isinstance(duration, bool) or not isinstance(duration, (int, float)) or
                    not math.isfinite(duration) or duration < 0):
                raise ValueError("invalid test duration")
            if not file.startswith("tests/e2e/") or ".." in Path(file).parts:
                raise ValueError("unexpected timing file path")
            entry = files.setdefault(file, {"full_ms": 0, "p0_ms": 0})
            entry["full_ms"] += duration
            tags = set(test["tags"])
            if "@p0" in tags and not tags & {"@dev-fixture", "@ai-live"}:
                entry["p0_ms"] += duration
    if not seen:
        raise ValueError("timing reports contain no tests")
    return {"version": 1, "source": {"commit": next(iter(commits)),
            "kind": "Playwright measured test durations including retries", "reports": len(reports)},
            "files": dict(sorted(files.items()))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(combine([json.loads(path.read_text())
                                             for path in args.reports]), indent=2) + "\n")
