#!/usr/bin/env python3
"""Prove that the production module can upgrade populated pre-release tables."""

import json
import os
import tomllib
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "scripts/tests/fixtures/stdb-production-upgrade"
TABLE_COLUMNS = json.loads((FIXTURE / "columns.json").read_text())


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=180)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, result.stdout + result.stderr)
    return result.stdout


def result_rows(value):
    if isinstance(value, dict):
        if "rows" in value:
            return value["rows"]
        for nested in value.values():
            rows = result_rows(nested)
            if rows is not None:
                return rows
    if isinstance(value, list):
        for nested in value:
            rows = result_rows(nested)
            if rows is not None:
                return rows
    return None


def main():
    module = Path(sys.argv[1]).resolve()
    if not module.is_file():
        raise SystemExit(f"production module does not exist: {module}")
    subprocess.run(
        ["cargo", "build", "--manifest-path", str(FIXTURE / "Cargo.toml"),
         "--locked", "--release", "--target", "wasm32-unknown-unknown"],
        check=True,
    )
    baseline = FIXTURE / "target/wasm32-unknown-unknown/release/lumiere_upgrade_baseline.wasm"
    with tempfile.TemporaryDirectory(prefix="lumiere-upgrade-") as directory:
        temp = Path(directory)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        host = f"http://127.0.0.1:{port}"
        cli = ["spacetime", "--config-path", str(temp / "cli.toml")]
        with (temp / "server.log").open("w+") as log:
            server = subprocess.Popen(
                ["spacetime", "start", "--listen-addr", f"127.0.0.1:{port}",
                 "--data-dir", str(temp / "data"), "--page_pool_max_size", "134217728",
                 "--non-interactive"], stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                for _ in range(120):
                    if server.poll() is not None:
                        raise RuntimeError("isolated SpacetimeDB server exited")
                    try:
                        request = urllib.request.Request(host + "/v1/identity", method="POST")
                        with urllib.request.urlopen(request, timeout=1):
                            break
                    except (urllib.error.URLError, TimeoutError):
                        time.sleep(0.25)
                else:
                    raise RuntimeError("isolated SpacetimeDB server did not become ready")

                database = "lumiere-production-upgrade"

                def publish(wasm):
                    output = run(*cli, "publish", database, "--bin-path", str(wasm),
                              "--server", host, "--delete-data=never",
                                 "--yes=remote,migrate,break-clients,skip-login", "--no-config")
                    print("\n".join(output.strip().splitlines()[-3:]))

                def query(sql):
                    output = run(*cli, "sql", database, sql, "--server", host,
                                 "--format", "json", "-y", "--no-config")
                    try:
                        value = json.loads(output)
                    except json.JSONDecodeError as error:
                        raise RuntimeError(f"SQL did not return JSON: {output}") from error
                    rows = result_rows(value)
                    if rows is None:
                        raise RuntimeError(f"SQL returned no result set: {output}")
                    return rows

                publish(baseline)
                before = {}
                for table, columns in TABLE_COLUMNS.items():
                    before[table] = query(f"SELECT {', '.join(columns)} FROM {table}")
                    if len(before[table]) != 1:
                        raise RuntimeError(f"baseline must contain one sentinel row in {table}")
                config = tomllib.loads((temp / "cli.toml").read_text())
                environment = dict(os.environ, STDB_HOST=host, STDB_MODULE=database,
                                   STDB_SERVER_TOKEN=config["spacetimedb_token"],
                                   STDB_WASM_PATH=str(module))
                publisher = subprocess.run(
                    ["bash", str(ROOT / "scripts/railway-publish-spacetimedb.sh")],
                    env=environment, text=True, capture_output=True, timeout=180,
                )
                if publisher.returncode:
                    raise subprocess.CalledProcessError(
                        publisher.returncode, publisher.args, publisher.stdout + publisher.stderr,
                    )
                if "SpacetimeDB publish and schema verification passed" not in publisher.stdout:
                    raise RuntimeError("publisher did not verify the published schema")
                print("Production publisher verified the migrated schema")
                for table, columns in TABLE_COLUMNS.items():
                    after = query(f"SELECT {', '.join(columns)} FROM {table}")
                    if after != before[table]:
                        raise RuntimeError(f"upgrade changed existing data in {table}")
                    print(f"Preserved {table}: every existing column matches")
                acceptance = query("SELECT acceptance_status FROM country_pack_definition")
                if "legacy_enabled" not in json.dumps(acceptance):
                    raise RuntimeError("country pack migration did not retain the legacy acceptance gate")
                print("Production schema upgrade passed with data deletion disabled")
            except Exception as error:
                if isinstance(error, subprocess.CalledProcessError):
                    print(error.output, file=sys.stderr)
                log.flush()
                log.seek(0)
                print(log.read()[-6000:], file=sys.stderr)
                raise
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
