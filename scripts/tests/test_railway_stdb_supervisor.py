import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest


SUPERVISOR = Path(__file__).resolve().parents[1] / "railway-stdb-supervisor.py"
REVISION = "a" * 40

WRITER = """#!/usr/bin/env python3
import os
from pathlib import Path
import signal
import sys
import time
pid = Path(os.environ["STDB_DATA_DIR"]) / "spacetime.pid"
def stop(*_args):
    pid.unlink()
    sys.exit(0)
signal.signal(signal.SIGINT, stop)
assert "RCLONE_CONFIG_TEST_SECRET_ACCESS_KEY" not in os.environ
pid.write_text(str(os.getpid()))
while True:
    time.sleep(0.1)
"""

BACKUP = """#!/usr/bin/env python3
import os
from pathlib import Path
import sys
import time
data = Path(os.environ["STDB_DATA_DIR"])
assert os.environ["STDB_BACKUP_MODULE_REVISION"] == "a" * 40
assert "RCLONE_CONFIG_TEST_SECRET_ACCESS_KEY" in os.environ
if sys.argv[1] == "--preflight":
    assert (data / "spacetime.pid").is_file()
    sys.exit(int(os.environ["PREFLIGHT_STATUS"]))
assert not (data / "spacetime.pid").exists()
(data / "capture-attempted").touch()
time.sleep(float(os.environ["CAPTURE_DELAY"]))
sys.exit(1)
"""


@unittest.skipUnless(hasattr(os, "pidfd_open"), "Linux PID file descriptors required")
class SupervisorTest(unittest.TestCase):
    def await_condition(self, condition, log_path):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if condition():
                return
            time.sleep(0.04)
        self.fail(log_path.read_text())

    def run_backup(self, *, preflight_status=0, capture_delay=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            request = root / "control" / "request"
            pid = root / "spacetime.pid"
            log_path = root / "supervisor.log"
            for name, source in [("writer", WRITER), ("backup", BACKUP)]:
                script = root / name
                script.write_text(source)
                script.chmod(0o700)
            code = (
                "import runpy, sys; from pathlib import Path; "
                "entry = runpy.run_path(sys.argv[1]); "
                "sys.exit(entry['supervise'](sys.argv[2], sys.argv[3], Path(sys.argv[4])))"
            )
            env = dict(
                os.environ,
                STDB_DATA_DIR=str(root),
                STDB_BACKUP_MAX_SECONDS="1",
                PREFLIGHT_STATUS=str(preflight_status),
                CAPTURE_DELAY=str(capture_delay),
                RCLONE_CONFIG_TEST_SECRET_ACCESS_KEY="fixture-only",
            )
            with log_path.open("w") as log, subprocess.Popen(
                [sys.executable, "-B", "-c", code, str(SUPERVISOR), str(root / "writer"),
                 str(root / "backup"), str(request)],
                env=env, stdout=log, stderr=subprocess.STDOUT,
            ) as supervisor:
                try:
                    self.await_condition(lambda: pid.exists() and pid.read_text().isdigit(), log_path)
                    before = pid.read_text()
                    incoming = request.with_suffix(".incoming")
                    incoming.write_text(REVISION)
                    incoming.rename(request)
                    self.await_condition(lambda: not request.exists(), log_path)
                    if preflight_status:
                        self.assertEqual(pid.read_text(), before)
                        self.assertFalse((root / "capture-attempted").exists())
                        self.assertIn("preflight failed", log_path.read_text())
                    else:
                        self.await_condition(
                            lambda: pid.exists() and pid.read_text().isdigit() and pid.read_text() != before,
                            log_path,
                        )
                        self.assertTrue((root / "capture-attempted").exists())
                        self.assertIn("capture failed", log_path.read_text())
                        self.assertIn("writer restarted", log_path.read_text())
                finally:
                    supervisor.terminate()
                    supervisor.wait(timeout=5)

    def test_preflight_failure_leaves_writer_online(self):
        self.run_backup(preflight_status=1)

    def test_failed_capture_restarts_writer(self):
        self.run_backup()

    def test_timed_out_capture_restarts_writer(self):
        self.run_backup(capture_delay=5)


if __name__ == "__main__":
    unittest.main()
