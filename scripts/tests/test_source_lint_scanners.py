"""Run the actual lint scripts in isolated source trees and constrained PATHs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ("lint-reducer-call-literals.sh", "lint-trusted-route-boundaries.sh")
RG = shutil.which("rg")
BASH = shutil.which("bash") or "/bin/bash"


class SourceLintScanners(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="source-lint-scanner-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        self.routes = self.root / "api-server/src/routes"
        (self.routes / "auth").mkdir(parents=True)
        (self.routes / "auth/invitations.rs").write_text("// No direct cookie authority\n")
        for script in SCRIPTS:
            shutil.copyfile(ROOT / "scripts" / script, self.root / "scripts" / script)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        os.symlink(shutil.which("dirname"), self.bin / "dirname")

    def scanner(self, contents=None):
        target = self.bin / "rg"
        if contents is None:
            os.symlink(RG, target)
        else:
            target.write_text(f"#!{BASH}\n{contents}\n")
            target.chmod(0o755)

    def run_lint(self, script):
        return subprocess.run(
            [BASH, str(self.root / "scripts" / script)], cwd=self.root,
            env={**os.environ, "PATH": str(self.bin)}, capture_output=True,
            text=True, timeout=10,
        )

    def assert_unconfirmed(self, result):
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertNotIn(": ok", result.stdout)
        self.assertNotIn(": ok", result.stderr)

    def test_missing_ripgrep_cannot_report_success(self):
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.run_lint(script)
                self.assert_unconfirmed(result)
                self.assertIn("ripgrep (rg) is required", result.stderr)

    def test_installed_but_failed_scanner_cannot_report_success(self):
        self.scanner("exit 2")
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.run_lint(script)
                self.assert_unconfirmed(result)
                self.assertIn("scanner failed", result.stderr)

    def test_filename_scan_errors_are_not_swallowed_by_process_substitution(self):
        self.scanner('if [[ "$1" == "-l" ]]; then exit 2; fi\nexit 1')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assert_unconfirmed(result)
        self.assertIn("scanner failed", result.stderr)

    @unittest.skipUnless(RG, "real ripgrep is not installed")
    def test_real_no_match_is_success_and_target_exclusion_is_preserved(self):
        self.scanner()
        (self.root / "target").mkdir()
        (self.root / "target/ignored.rs").write_text('db.call_reducer("ignored")\n')
        (self.routes / "notes.txt").write_text('db.call_reducer("not_rust")\n')
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.run_lint(script)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn(f"{script[:-3]}: ok", result.stdout)

    @unittest.skipUnless(RG, "real ripgrep is not installed")
    def test_real_reducer_dispatch_violation_is_rejected(self):
        self.scanner()
        (self.routes / "new_route.rs").write_text('db.call_reducer("untrusted")\n')
        for script in SCRIPTS:
            with self.subTest(script=script):
                result = self.run_lint(script)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertNotIn(": ok", result.stdout)

    @unittest.skipUnless(RG, "real ripgrep is not installed")
    def test_real_route_allowlists_are_preserved(self):
        self.scanner()
        (self.routes / "admin.rs").write_text('state.client_with_token(&session.stdb_token).query_sql("SELECT 1")\n')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        (self.routes / "new_route.rs").write_text('state.client_with_token(&session.stdb_token)\n')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assertEqual(result.returncode, 1)
        self.assertIn("raw session-token client construction is forbidden", result.stderr)

    @unittest.skipUnless(RG, "real ripgrep is not installed")
    def test_real_query_authority_and_cookie_checks_still_run(self):
        self.scanner()
        path = self.routes / "new_route.rs"
        path.write_text('db.query_sql("SELECT 1")\n')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assertEqual(result.returncode, 1)
        self.assertIn("handwritten SQL lacks trusted read authority", result.stderr)
        path.write_text('use crate::TrustedOperationContext;\ncontext.query_sql("SELECT 1")\n')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        (self.routes / "auth/invitations.rs").write_text('cookies.get("stdb_identity")\n')
        result = self.run_lint("lint-trusted-route-boundaries.sh")
        self.assertEqual(result.returncode, 1)
        self.assertIn("identity cookie", result.stderr)


if __name__ == "__main__":
    unittest.main()
