#!/usr/bin/env python3
"""Balance whole Playwright files without changing suite filters or coverage."""
import argparse
import json
import math
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
TEST_FILE = re.compile(r"\.(?:spec|test)\.[cm]?[jt]sx?$")
SAFE_PATH = re.compile(r"tests/e2e/[A-Za-z0-9_./-]+$")


def discover(root):
    web = root / "frontend/web"
    files = sorted(path.relative_to(web).as_posix()
                   for path in (web / "tests/e2e").rglob("*")
                   if path.is_file() and TEST_FILE.search(path.name))
    if not files or any(not SAFE_PATH.fullmatch(path) for path in files):
        raise ValueError("missing test files or unsupported test path")
    return files


def balance(matrix, files, timings):
    if len(set(files)) != len(files) or not files:
        raise ValueError("test inventory must be nonempty and unique")
    result = []
    for suite in ("full", "p0", "pretenant", "targeted"):
        lanes = [lane for lane in matrix if lane["suite"] == suite]
        if not lanes:
            continue
        if suite not in ("full", "p0"):
            result.extend(lanes)
            continue
        count = len(lanes)
        expected = {f"{index}/{count}" for index in range(1, count + 1)}
        if ({lane.get("shard") for lane in lanes} != expected or
                {lane.get("slot") for lane in lanes} != {str(i) for i in range(1, count + 1)}):
            raise ValueError("shard matrix is incomplete or duplicated")
        groups = [[] for _ in lanes]
        loads = [0] * count
        def weight(path):
            value = timings.get(path, {}).get(f"{suite}_ms", 30_000)
            if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                    not math.isfinite(value) or value < 0):
                raise ValueError("invalid scheduling duration")
            return max(1_000, value)
        for path in sorted(files, key=lambda path: (-weight(path), path)):
            index = min(range(count), key=lambda index: (loads[index], index))
            groups[index].append(path)
            loads[index] += weight(path)
        assigned = [path for group in groups for path in group]
        if sorted(assigned) != sorted(files) or any(not group for group in groups):
            raise ValueError("shard assignment must cover every file exactly once")
        for lane, group, load in zip(sorted(lanes, key=lambda lane: int(lane["slot"])), groups, loads):
            # Positional Playwright file arguments are regular expressions.
            # Anchor and escape each complete relative path; never narrow tags.
            result.append({**lane, "balanced": True,
                           "specs": " ".join(re.escape(path) + "$" for path in sorted(group)),
                           "estimated_ms": round(load), "file_count": len(group)})
    if len(result) != len(matrix):
        raise ValueError("unsupported suite in matrix")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", required=True)
    parser.add_argument("--github-output", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    baseline = json.loads((ROOT / "scripts/playwright-test-durations.json").read_text())
    if baseline.get("version") != 1:
        raise ValueError("unsupported duration baseline")
    matrix = balance(json.loads(args.matrix), discover(ROOT), baseline["files"])
    report = Path(args.report)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"version": 1, "matrix": matrix}, indent=2) + "\n")
    with open(args.github_output, "a") as output:
        output.write("configs=" + json.dumps(matrix, separators=(",", ":")) + "\n")
    for lane in matrix:
        print(f"{lane['suite']} {lane.get('shard', '')}: "
              f"{lane.get('file_count', 'selected')} files, "
              f"{lane.get('estimated_ms', 0) / 60_000:.1f} estimated minutes")


if __name__ == "__main__":
    main()
