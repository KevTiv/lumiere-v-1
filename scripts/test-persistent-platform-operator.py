#!/usr/bin/env python3
"""Local-only production-wrapper proof. Requires Python 3.11+, built API/dev WASM.

Runs the production module build, but never builds the API or contacts providers.
Subprocess output is private except redacted local publisher failure diagnostics.
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NONE = {"none": []}


def require(condition):
    if not condition:
        raise RuntimeError("proof assertion failed")


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def identity(value):
    if isinstance(value, (list, tuple)):
        require(len(value) == 1)
        value = value[0]
    if isinstance(value, dict):
        value = value["__identity__"]
    if isinstance(value, int):
        return f"{value:064x}"
    value = str(value).removeprefix("0x").lower()
    require(re.fullmatch("[0-9a-f]{64}", value))
    return value


def some(value):
    require(isinstance(value, list) and len(value) == 2 and value[0] == 0)
    return value[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Proof:
    def __init__(self, temp):
        self.temp = temp
        self.children = []
        self.phase = "preflight"
        # Deliberately do not inherit deployment credentials or database settings.
        self.env = {k: v for k, v in os.environ.items()
                    if k in ("PATH", "HOME", "USER", "TMPDIR", "RUSTUP_HOME", "CARGO_HOME",
                             "SYSTEMROOT", "LANG")}
        self.env.update(CARGO_BUILD_JOBS="1", CARGO_INCREMENTAL="0")
        self.http = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())
        self.pg_started = False
        self.synthetic_tokens = []

    def run(self, args, *, env=None, data=None, ok=True, timeout=180):
        child = subprocess.Popen(
            [str(x) for x in args], cwd=ROOT, env=env or self.env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True)
        self.children.append(child)
        try:
            out, err = child.communicate(data, timeout=timeout)
        except BaseException:
            self.stop(child)
            raise
        if (child.returncode == 0) != ok and Path(str(args[0])).name == "spacetime":
            # These are exclusively local synthetic credentials. Only emit
            # publisher diagnostics when its private config can be read and
            # every minted token can be removed first.
            try:
                owner = tomllib.loads((self.temp / "cli.toml").read_text())["spacetimedb_token"]
                diagnostics = out + err
                for token in [owner, *self.synthetic_tokens]:
                    diagnostics = diagnostics.replace(token, "[redacted-local-token]")
                print(diagnostics, file=sys.stderr)
            except (OSError, KeyError, tomllib.TOMLDecodeError):
                pass
        require((child.returncode == 0) == ok)
        return out

    @staticmethod
    def stop(child):
        if child.poll() is not None:
            return
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()

    def request(self, path, token=None, body=None, raw=False, ok=True):
        headers = {}
        if token:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Content-Type"] = "text/plain" if raw else "application/json"
        data = body.encode() if raw else (
            json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.host + path, data=data, headers=headers,
                                     method="POST")
        try:
            with self.http.open(req, timeout=30) as response:
                content = response.read()
                response_headers = response.headers
        except urllib.error.HTTPError as error:
            if ok or error.code not in (400, 401, 403, 404, 500, 530):
                print(f"Unexpected local HTTP status: {error.code}", file=sys.stderr)
            require(not ok and error.code in (400, 401, 403, 404, 500, 530))
            return None, None
        require(ok)
        return json.loads(content) if content else None, response_headers

    def sql(self, sql):
        result, headers = self.request(
            f"/v1/database/{self.db}/sql", self.owner, sql, raw=True)
        rows = []
        for statement in result:
            names = [column["name"]["some"] for column in statement["schema"]["elements"]]
            rows.extend(dict(zip(names, row)) for row in statement["rows"])
        return rows, headers

    def rows(self, table):
        return sorted(self.sql("SELECT * FROM " + table)[0],
                      key=lambda row: json.dumps(row, sort_keys=True))

    def call(self, token, reducer, args, ok=True):
        return self.request(f"/v1/database/{self.db}/call/{reducer}",
                            token, args, ok=ok)

    def new_identity(self):
        result, _ = self.request("/v1/identity")
        self.synthetic_tokens.append(result["token"])
        return identity(result["identity"]), result["token"]

    def publish(self, wasm):
        self.run(["spacetime", "--config-path", self.temp / "cli.toml",
                  "publish", self.db, "--bin-path", wasm, "--server", self.host,
                  "--yes=remote,migrate,break-clients,skip-login",
                  "--no-config", "--delete-data=never"], timeout=300)

    def pg(self, sql):
        return self.run(["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
                        env=self.pg_env, data=sql)

    def stage(self, name):
        self.phase = name

    def passed(self, fact):
        print("PASS " + fact, flush=True)

    def execute(self, args):
        self.stage("local SpacetimeDB startup")
        self.host = f"http://127.0.0.1:{port()}"
        self.db = "lumiere-operator-test-" + uuid.uuid4().hex[:12]
        log = (self.temp / "stdb.log").open("w")
        try:
            child = subprocess.Popen(
                ["spacetime", "start", "--listen-addr", self.host.removeprefix("http://"),
                 "--data-dir", str(self.temp / "stdb"), "--page_pool_max_size",
                 "134217728", "--non-interactive"], env=self.env, stdout=log,
                stderr=subprocess.STDOUT, start_new_session=True)
            self.children.append(child)
        finally:
            log.close()
        for _ in range(120):
            require(child.poll() is None)
            try:
                self.new_identity()
                break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.25)
        else:
            raise RuntimeError("startup timed out")
        self.stage("development fixture")
        self.publish(args.development_wasm)
        self.owner = tomllib.loads((self.temp / "cli.toml").read_text())["spacetimedb_token"]
        self.synthetic_tokens.append(self.owner)
        _, headers = self.sql("SELECT id FROM user_profile")
        a = identity(headers["spacetime-identity"])
        b, bt = self.new_identity()
        require(a != b)
        self.call(bt, "ensure_dev_admin", [])
        bm = [m for m in self.rows("user_organization")
              if identity(m["user_identity"]) == b]
        require(len(bm) == 1)
        org, company = bm[0]["organization_id"], some(bm[0]["company_id"])
        self.call(bt, "create_role", [org, {
            "name": "operator_fixture", "description": NONE, "parent_id": NONE,
            "permissions": [], "is_active": True, "metadata": NONE}])
        roles = [r for r in self.rows("role")
                 if r["name"] == "operator_fixture" and r["organization_id"] == org]
        require(len(roles) == 1)
        role_id = roles[0]["id"]
        suffix = uuid.uuid4().hex[:12]
        platform = "p_local_operator_" + suffix

        def fixture(who, platform_id):
            self.call(bt, "add_user_to_organization", [
                {"__identity__": "0x" + who}, org, {
                    "role_id": role_id, "company_id": {"some": company},
                    "job_title": NONE, "department_id": NONE, "employee_id": NONE,
                    "is_active": True, "is_default": True,
                    "metadata": {"some": "lumiere-platform-bootstrap-request-v1"}}])
            self.call(bt, "bind_user_profile", [
                platform_id, {"__identity__": "0x" + who}])
            p = [r for r in self.rows("user_profile") if identity(r["identity"]) == who]
            m = [r for r in self.rows("user_organization")
                 if identity(r["user_identity"]) == who]
            require(len(p) == len(m) == 1)
            self.sql(f"UPDATE user_profile SET is_active = false WHERE id = {p[0]['id']} "
                     f"AND identity = 0x{who} AND organization_id = {org}")
            self.sql(f"UPDATE user_organization SET is_active = false WHERE id = {m[0]['id']} "
                     f"AND user_identity = 0x{who} AND organization_id = {org}")
            return p[0]["id"], m[0]["id"]

        pid, mid = fixture(a, platform)
        c, _ = self.new_identity()
        fixture(c, "p_local_history_" + suffix)
        before = {t: self.rows(t) for t in (
            "user_profile", "user_organization", "role", "ai_spend_budget",
            "ai_spend_reservation", "user_credential")}
        profile = next(r for r in before["user_profile"] if r["id"] == pid)
        lease = some(profile["metadata"])
        member = next(r for r in before["user_organization"] if r["id"] == mid)
        require(some(member["metadata"]) == lease and not profile["is_superuser"])
        self.passed("synthetic inactive operator and inactive role history created")

        self.stage("canonical PostgreSQL fixture")
        pgdata = self.temp / "pg"
        self.run(["initdb", "-D", pgdata, "-U", "operator_test", "--auth-local=reject",
                  "--auth-host=trust", "--no-locale", "--encoding=UTF8"])
        # No Unix socket, and no trust entries for non-loopback addresses.
        (pgdata / "pg_hba.conf").write_text(
            "host all operator_test 127.0.0.1/32 trust\n")
        pgport = port()
        self.pg_started = True
        self.run(["pg_ctl", "-D", pgdata, "-l", self.temp / "postgres.log",
                  "-o", f"-h 127.0.0.1 -p {pgport} -k ''", "-w", "start"])
        database = "lumiere_operator_test_" + suffix
        self.pg_env = dict(self.env, PGHOST="127.0.0.1", PGPORT=str(pgport),
                           PGUSER="operator_test", PGDATABASE=database,
                           PGSSLMODE="disable")
        self.run(["createdb", database], env=self.pg_env)
        schema = (ROOT / "api-server/src/platform_control/schema.rs").read_text()
        ddl = []
        for constant in ("PLATFORM_SCHEMA_BOOTSTRAP_DDL", "PLATFORM_CONTROL_DDL"):
            match = re.search(r"pub const " + constant + r': &str = r#"(.*?)"#;', schema, re.S)
            require(match is not None)
            ddl.append(match[1])
        def quote(text):
            return "'" + text.replace("'", "''") + "'"
        self.pg("\n".join(ddl) + f"""
INSERT INTO lumiere_platform.user_profile
(platform_user_id,stdb_identity_hex,email,is_active,is_superuser,metadata)
VALUES ({quote(platform)},{quote(a)},'operator@local.invalid',false,false,
{quote(json.dumps(lease))}::jsonb);
""")
        def canonical():
            return json.loads(self.pg(
                "SELECT row_to_json(p) FROM lumiere_platform.user_profile p;"))
        pg_before = canonical()
        policy = f"{a}:{org}:{company}:local-operator-proof"
        self.stage("production wrapper build")
        require(shutil.disk_usage(ROOT).free >= 4 * 1024**3)
        self.run(["make", "contracts-module-production-ci"],
                 env=dict(self.env, LUMIERE_PERSISTENT_PLATFORM_OPERATOR=policy,
                          LUMIERE_ENABLE_DEV_REDUCERS="0"), timeout=3600)
        production = self.temp / "production.wasm"
        shutil.copy2(ROOT / ".ci/contracts-module.wasm", production)
        self.stage("production wrapper local update")
        self.publish(production)
        self.stage("production update fixture preservation")
        unchanged = {t: self.rows(t) for t in before}
        for table in before:
            if unchanged[table] != before[table]:
                old = {row["id"]: row for row in before[table]}
                new = {row["id"]: row for row in unchanged[table]}
                fields = set()
                for key in old.keys() & new.keys():
                    fields.update(field for field in old[key]
                                  if old[key][field] != new[key].get(field))
                print(f"Fixture delta: {table}; rows {len(old)} -> {len(new)}; fields {sorted(fields)}",
                      flush=True)
        require(unchanged == before)
        audits_before = self.rows("audit_log")
        for reducer in ("ensure_dev_admin", "dev_promote_caller_superuser"):
            self.stage("production rejects " + reducer)
            self.call(bt, reducer, [], ok=False)
        self.stage("compiled enrollment rejects the other fixture principal")
        self.call(bt, "enroll_persistent_platform_operator", [True], ok=False)
        self.stage("failed guard calls preserve application rows")
        guarded = {t: self.rows(t) for t in before}
        for table in before:
            if table == "user_profile":
                require(len(guarded[table]) == len(before[table]))
                for old in before[table]:
                    new = next(row for row in guarded[table] if row["id"] == old["id"])
                    # Authentication can invoke the existing connection hook
                    # for fixture admin B after a module update. It must not
                    # change authority, metadata, settings, or another principal.
                    allowed = {"updated_at", "last_login"} if identity(old["identity"]) == b else set()
                    changed = {key for key in old if old[key] != new.get(key)}
                    if changed - allowed:
                        print(f"Unexpected guard-call profile fields: {sorted(changed)}", flush=True)
                    require(changed <= allowed)
            else:
                if guarded[table] != before[table]:
                    print(f"Guard call changed local fixture table: {table}", flush=True)
                require(guarded[table] == before[table])
        current_audits = self.rows("audit_log")
        if current_audits != audits_before:
            print(f"Guard-call audit count: {len(audits_before)} -> {len(current_audits)}", flush=True)
        require(current_audits == audits_before)
        before = guarded
        self.passed("production-compiled update preserves fixtures; dev and wrong-principal calls denied")
        api_env = dict(self.env, STDB_HOST=self.host, STDB_MODULE=self.db,
                       STDB_SERVER_TOKEN=self.owner,
                       LUMIERE_PERSISTENT_PLATFORM_OPERATOR=policy,
                       PG_HOST="127.0.0.1", PG_PORT=str(pgport), PG_DATABASE=database,
                       PG_USER="operator_test",
                       PG_TLS_MODE="disable", NODE_ENV="development",
                       LUMIERE_ENV="development")

        def cli(mode, ok=True):
            output = self.run([args.api_binary, "platform-operator", "--" + mode],
                              env=api_env, ok=ok)
            return json.loads(output) if ok else None

        self.stage("private API CLI lifecycle")
        plan = cli("plan")
        require(plan["nativeEnrolled"] is False and plan["canonicalCoherent"] is False)
        cli("check", ok=False)
        for mode, changed in (("apply", True), ("check", False), ("apply", False)):
            report = cli(mode)
            require(report["nativeEnrolled"] is True
                    and report["canonicalCoherent"] is True
                    and report["interactiveSessionsAllowed"] is False
                    and report["changed"] is changed)
        after = {t: self.rows(t) for t in before}
        for table, allowed, target in (
                ("user_profile", {"is_active", "is_superuser", "metadata", "updated_at", "last_login"}, pid),
                ("user_organization", {"is_active", "metadata"}, mid)):
            require(len(before[table]) == len(after[table]))
            for old in before[table]:
                new = next(r for r in after[table] if r["id"] == old["id"])
                permitted = allowed if old["id"] == target else set()
                require({k: v for k, v in old.items() if k not in permitted}
                        == {k: v for k, v in new.items() if k not in permitted})
        for table in set(before) - {"user_profile", "user_organization"}:
            require(before[table] == after[table])
        p = next(r for r in after["user_profile"] if r["id"] == pid)
        m = next(r for r in after["user_organization"] if r["id"] == mid)
        require(p["is_active"] and p["is_superuser"] and m["is_active"])
        marker = json.loads(some(p["metadata"]))
        require(some(m["metadata"]) == some(p["metadata"]))
        pg_after = canonical()
        require(pg_after["is_active"] and pg_after["is_superuser"]
                and pg_after["metadata"] == marker)
        require({k: v for k, v in pg_before.items()
                 if k not in {"is_active", "is_superuser", "metadata"}}
                == {k: v for k, v in pg_after.items()
                    if k not in {"is_active", "is_superuser", "metadata"}})
        require(self.pg("SELECT count(*) FROM lumiere_platform.user_credential;").strip() == "0")
        audits = self.rows("audit_log")
        added = [r for r in audits if r not in audits_before]
        require(len(added) == 2)
        require({(r["table_name"], r["record_id"]) for r in added}
                == {("user_profile", pid), ("user_organization", mid)})
        for audit in added:
            require(audit["action"] == "persistent_platform_operator_enrollment"
                    and identity(audit["user_identity"]) == a
                    and audit["organization_id"] == org
                    and some(audit["company_id"]) == company
                    and some(audit["metadata"]) == some(p["metadata"]))
        self.passed("plan/check/apply/check/replay verified; two exact audits, no credentials or budget changes")
        self.stage("native administrative authority and revocation")
        d, _ = self.new_identity()
        self.call(self.owner, "register_cold_tier_service_identity", [
            org, "local-worker-binding", "operator_fixture_worker",
            {"__identity__": "0x" + d}])
        workers = [r for r in self.rows("cold_tier_service_identity")
                   if r["platform_id"] == "local-worker-binding"]
        require(len(workers) == 1 and identity(workers[0]["identity"]) == d)
        for table in ("ai_spend_budget", "ai_spend_reservation", "user_credential"):
            require(self.rows(table) == before[table])
        self.sql(f"UPDATE user_profile SET is_superuser = false WHERE id = {pid} "
                 f"AND identity = 0x{a} AND organization_id = {org}")
        revoked = {t: self.rows(t) for t in before}
        revoked_audits = self.rows("audit_log")
        cli("apply", ok=False)
        rejected = {t: self.rows(t) for t in before}
        for table in revoked:
            require(len(rejected[table]) == len(revoked[table]))
            for old in revoked[table]:
                new = next(row for row in rejected[table] if row["id"] == old["id"])
                allowed = {"updated_at", "last_login"} if table == "user_profile" and old["id"] == pid else set()
                require({key: value for key, value in old.items() if key not in allowed}
                        == {key: value for key, value in new.items() if key not in allowed})
        require(self.rows("audit_log") == revoked_audits)
        self.passed("real native admin action persisted; revoked root not regranted or re-audited")

    def cleanup(self):
        if self.pg_started:
            try:
                self.run(["pg_ctl", "-D", self.temp / "pg", "-m", "immediate",
                          "-w", "stop"], timeout=30)
            except Exception:
                # A private postmaster may have detached from pg_ctl's group.
                pidfile = self.temp / "pg/postmaster.pid"
                if pidfile.exists():
                    try:
                        os.kill(int(pidfile.read_text().splitlines()[0]), signal.SIGTERM)
                    except ProcessLookupError:
                        pass
        for child in reversed(self.children):
            self.stop(child)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--development-wasm", required=True, type=Path)
    parser.add_argument("--api-binary", required=True, type=Path)
    args = parser.parse_args()
    args.development_wasm = args.development_wasm.resolve()
    args.api_binary = args.api_binary.resolve()
    require(args.development_wasm.is_file() and args.api_binary.is_file())
    artifact = ROOT / ".ci/contracts-module.wasm"
    with tempfile.TemporaryDirectory(prefix="lumiere-operator-proof-") as directory:
        temp = Path(directory)
        os.chmod(temp, 0o700)
        backup = temp / "original.wasm"
        existed = artifact.exists()
        if existed:
            shutil.copy2(artifact, backup)
        proof = Proof(temp)
        def interrupt(signum, frame):
            raise KeyboardInterrupt
        old_handlers = {s: signal.signal(s, interrupt) for s in (signal.SIGTERM, signal.SIGINT)}
        try:
            proof.execute(args)
        except BaseException:
            print("FAIL " + proof.phase + " (private diagnostics suppressed)", file=sys.stderr)
            return 1
        finally:
            try:
                proof.cleanup()
            finally:
                if existed:
                    shutil.copy2(backup, artifact)
                elif artifact.exists():
                    artifact.unlink()
                for sig, handler in old_handlers.items():
                    signal.signal(sig, handler)
    return 0


if __name__ == "__main__":
    sys.exit(main())
