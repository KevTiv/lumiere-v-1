#!/usr/bin/env python3
"""Run Standalone with a local, operator-triggered backup maintenance window."""

import datetime
import os
from pathlib import Path
import re
import secrets
import select
import signal
import subprocess
import sys
import tempfile
import time


ENTRYPOINT = "/usr/local/bin/lumiere-spacetimedb"
BACKUP = "/usr/local/bin/lumiere-stdb-backup"
REQUEST = Path("/run/lumiere-stdb-supervisor/backup-request")
POLL_INTERVAL = 0.2
STOP_TIMEOUT = 20


def log(message):
    print(f"lumiere-stdb-supervisor: {message}", flush=True)


def writer_pidfd(data_dir, parent):
    """Only target the current server process launched by this supervisor."""
    pid = int((data_dir / "spacetime.pid").read_text().strip())
    if pid <= 1:
        raise ValueError("invalid writer PID")
    pidfd = os.pidfd_open(pid)
    try:
        ancestor = pid
        while ancestor > 1 and ancestor != parent:
            stat = Path(f"/proc/{ancestor}/stat").read_text()
            ancestor = int(stat.rsplit(")", 1)[1].split()[1])
        if ancestor != parent:
            raise ValueError("writer is outside the supervised process tree")
        return pidfd
    except BaseException:
        os.close(pidfd)
        raise


def stop_writer(writer, data_dir):
    try:
        pidfd = writer_pidfd(data_dir, writer.pid)
    except (OSError, ValueError, IndexError):
        log("could not identify the supervised writer")
        return False

    try:
        signal.pidfd_send_signal(pidfd, signal.SIGINT)
        if writer.wait(timeout=STOP_TIMEOUT) != 0:
            return False
        return bool(select.select([pidfd], [], [], 0)[0])
    except subprocess.TimeoutExpired:
        log("writer did not shut down cleanly; forcing restart without capture")
        try:
            signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            writer.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(writer.pid, signal.SIGKILL)
            writer.wait(timeout=5)
        return False
    except OSError:
        log("could not signal the supervised writer")
        return False
    finally:
        os.close(pidfd)


def run_command(command, limit, stopping, environment):
    with subprocess.Popen(command, env=environment, start_new_session=True) as process:
        deadline = time.monotonic() + limit
        while not stopping() and time.monotonic() < deadline:
            try:
                return process.wait(timeout=POLL_INTERVAL) == 0
            except subprocess.TimeoutExpired:
                pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        return False


def supervise(entrypoint=ENTRYPOINT, backup=BACKUP, request_path=REQUEST):
    data_dir = Path(os.environ.get("STDB_DATA_DIR", "/data"))
    limit = int(os.environ.get("STDB_BACKUP_MAX_SECONDS", "300"))
    if not 1 <= limit <= 900:
        raise ValueError("STDB_BACKUP_MAX_SECONDS must be between 1 and 900")
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", str(data_dir)):
        raise ValueError("invalid data directory")

    writer_env = {
        key: value for key, value in os.environ.items()
        if not key.startswith(("STDB_BACKUP_", "RCLONE_", "AWS_", "AGE_"))
    }
    shutting_down = False
    request_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    request_path.unlink(missing_ok=True)

    def request_shutdown(_signum, _frame):
        nonlocal shutting_down
        shutting_down = True

    def stopping():
        return shutting_down

    def start_writer():
        return subprocess.Popen([entrypoint], env=writer_env, start_new_session=True)

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    writer = start_writer()

    try:
        while not stopping():
            if writer.poll() is not None:
                log("writer exited outside a backup window")
                return writer.returncode or 1
            try:
                revision = request_path.read_text().strip()
            except FileNotFoundError:
                time.sleep(POLL_INTERVAL)
                continue
            if not re.fullmatch(r"[0-9a-f]{40}", revision):
                log("request refused: invalid module revision")
                request_path.unlink()
                continue

            environment = dict(os.environ, STDB_BACKUP_MODULE_REVISION=revision)
            now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_id = f"{now}-{secrets.token_hex(4)}"
            try:
                log(f"preflight {backup_id}")
                if not run_command([backup, "--preflight", backup_id], 30, stopping, environment):
                    log(f"preflight failed {backup_id}")
                    continue
                if stopping():
                    break
                if not stop_writer(writer, data_dir):
                    log(f"capture refused after unclean shutdown {backup_id}")
                    continue
                success = run_command([backup, backup_id], limit, stopping, environment)
                log(f"capture {'completed' if success else 'failed'} {backup_id}")
            except OSError as error:
                log(f"capture failed {backup_id}: {error.strerror}")
            finally:
                if not stopping() and writer.poll() is not None:
                    writer = start_writer()
                    log(f"writer restarted {backup_id}")
                request_path.unlink(missing_ok=True)
        return 0
    finally:
        if writer.poll() is None and not stop_writer(writer, data_dir):
            try:
                os.killpg(writer.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            writer.wait()


def request(revision, request_path=REQUEST):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("provide the active module revision as a 40-character Git SHA")
    argv = Path("/proc/1/cmdline").read_bytes().split(b"\0")
    if os.geteuid() != 0 or len(argv) < 3 or argv[1] != os.fsencode(__file__):
        raise RuntimeError("request requires root inside the backup-capable service")

    descriptor, temporary = tempfile.mkstemp(dir=request_path.parent)
    try:
        with os.fdopen(descriptor, "w") as file:
            file.write(revision + "\n")
        os.link(temporary, request_path)
    except FileExistsError:
        raise RuntimeError("a backup request is already pending") from None
    finally:
        os.unlink(temporary)
    log("backup queued; check service logs for the outcome")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "request":
        request(sys.argv[2])
    elif sys.argv[1:] == []:
        sys.exit(supervise())
    else:
        sys.exit("usage: railway-stdb-supervisor.py [request MODULE_REVISION]")
