#!/usr/bin/env python3
"""Run a focused Cargo test gate, rejecting stale selectors that select no tests."""

import subprocess
import sys


def has_selected_tests(listing: str) -> bool:
    return any(line.rstrip().endswith(": test") for line in listing.splitlines())


def main(args: list[str]) -> int:
    # Test-harness flags (e.g. --nocapture) must not alter the discovery command.
    cargo_args = args[:args.index("--")] if "--" in args else args
    discovery = subprocess.run(
        ["cargo", "test", *cargo_args, "--", "--list"],
        text=True, stdout=subprocess.PIPE, check=False,
    )
    if discovery.returncode:
        return discovery.returncode
    if not has_selected_tests(discovery.stdout):
        print("Required Cargo test selector matched zero tests", file=sys.stderr)
        return 1
    return subprocess.run(["cargo", "test", *args], check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
