#!/usr/bin/env python3
"""Verify every discovered non-setup test belongs to exactly one planned lane."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def verify(report, lanes, web):
    if report.get("errors"):
        raise ValueError("Playwright discovery failed")
    inventory = []
    def walk(suites):
        for suite in suites:
            for spec in suite.get("specs", []):
                file = (Path(report["config"]["rootDir"]) / spec["file"]).relative_to(web).as_posix()
                for test in spec["tests"]:
                    if test["projectName"] == "setup":
                        continue
                    owners = [i for i, lane in enumerate(lanes)
                              if any(re.search(pattern, file) for pattern in lane["specs"].split())]
                    if len(owners) != 1:
                        raise ValueError(f"discovered test file has {len(owners)} owners: {file}")
                    inventory.append(owners[0])
            walk(suite.get("suites", []))
    walk(report["suites"])
    if not inventory or set(inventory) != set(range(len(lanes))):
        raise ValueError("every shard must contain discovered tests")
    return len(inventory)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", required=True)
    args = parser.parse_args()
    matrix = json.loads(args.matrix)
    for suite in ("full", "p0"):
        lanes = [lane for lane in matrix if lane["suite"] == suite and lane.get("balanced")]
        if not lanes:
            continue
        with tempfile.TemporaryDirectory(prefix="playwright-discovery-") as directory:
            output = Path(directory) / "discovery.json"
            command = ["pnpm", "exec", "playwright", "test", "--list", "--reporter=json"]
            if suite == "p0":
                command += ["--grep", "@p0", "--grep-invert",
                            "@dev-fixture" if os.environ.get("E2E_REQUIRE_AI") == "1"
                            else "@dev-fixture|@ai-live"]
            elif os.environ.get("E2E_REQUIRE_AI") != "1":
                command += ["--grep-invert", "@ai-live"]
            result = subprocess.run(command, cwd=ROOT / "frontend/web", capture_output=True,
                                    env={**os.environ, "PLAYWRIGHT_JSON_OUTPUT_FILE": str(output)})
            if result.returncode:
                raise SystemExit("Playwright discovery failed; refusing partial coverage")
            count = verify(json.loads(output.read_text()), lanes, ROOT / "frontend/web")
            print(f"{suite}: all {count} discovered test instances have exactly one shard")
