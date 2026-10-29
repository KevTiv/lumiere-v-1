import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class RustSdkGenerationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.module = self.directory / "bindings/mod.rs"
        wasm = self.directory / "module.wasm"
        wasm.write_bytes(b"fixture")
        cli = self.directory / "spacetime"
        cli.write_text(
            "#!/bin/bash\nset -eu\n"
            'while [ "$#" -gt 0 ]; do\n'
            '  if [ "$1" = --out-dir ]; then out="$2"; shift; fi\n'
            "  shift\n"
            "done\n"
            'if [ "$MISSING_MODULE" != 1 ]; then\n'
            '  printf "%s\\n" "pub struct Row {" "    pub ref: String," '
            '"    pub type: String," "}" > "$out/mod.rs"\n'
            "fi\n"
            'printf "%b\\n" "$DIAGNOSTIC" >&2\n'
            'exit "$CLI_EXIT"\n'
        )
        cli.chmod(0o755)
        formatter = self.directory / "rustfmt"
        formatter.write_text(
            "#!/bin/bash\nset -eu\n"
            'if [ "$FORMAT_EXIT" != 0 ]; then exit "$FORMAT_EXIT"; fi\n'
            'for file in "$@"; do\n'
            '  if [[ "$file" = *.rs ]] && grep -Eq "pub (ref|type):" "$file"; then\n'
            "    echo 'keyword repair was not applied' >&2; exit 1\n"
            "  fi\n"
            "done\n"
        )
        formatter.chmod(0o755)
        self.environment = {
            **os.environ,
            "SPACETIME_BIN": str(cli),
            "RUSTFMT_BIN": str(formatter),
            "STDB_GENERATE_WASM": str(wasm),
            "TMPDIR": str(self.directory),
        }

    def generate(self, diagnostic="", exit_code=0, format_exit=0, missing_module=False):
        environment = {
            **self.environment,
            "DIAGNOSTIC": diagnostic,
            "CLI_EXIT": str(exit_code),
            "FORMAT_EXIT": str(format_exit),
            "MISSING_MODULE": "1" if missing_module else "0",
        }
        result = subprocess.run(
            ["bash", str(ROOT / "scripts/generate-spacetimedb-rust-sdk.sh"),
             str(self.module.parent), str(ROOT / "spacetimedb")],
            cwd=ROOT, env=environment, text=True, capture_output=True, timeout=15,
        )
        return result, self.module.read_text() if self.module.exists() else ""

    def test_success_preserves_unchanged_files_and_removes_stale_apis(self):
        result, original = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        unchanged_time = 1_600_000_000_123_456_789
        os.utime(self.module, ns=(unchanged_time, unchanged_time))
        stale = self.module.parent / "removed_reducer.rs"
        stale.write_text("pub struct Removed;\n")

        result, regenerated = self.generate()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(regenerated, original)
        self.assertEqual(self.module.stat().st_mtime_ns, unchanged_time)
        self.assertFalse(stale.exists())

    def test_failed_generation_or_validation_preserves_existing_snapshot(self):
        original = "pub struct Working;\n"
        unchanged_time = 1_600_000_000_123_456_789
        self.module.parent.mkdir()
        self.module.write_text(original)
        os.utime(self.module, ns=(unchanged_time, unchanged_time))
        stale = self.module.parent / "existing_reducer.rs"
        stale.write_text("pub struct Existing;\n")
        for failure in (
            {"diagnostic": "error: unexpected generator failure"},
            {"exit_code": 2},
            {"format_exit": 2},
            {"missing_module": True},
        ):
            with self.subTest(failure=failure):
                result, output = self.generate(**failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, original)
                self.assertEqual(self.module.stat().st_mtime_ns, unchanged_time)
                self.assertEqual(stale.read_text(), "pub struct Existing;\n")
                self.assertEqual(sorted(p.name for p in self.module.parent.iterdir()),
                                 ["existing_reducer.rs", "mod.rs"])

    def test_recovers_only_keyword_diagnostics_for_zero_or_nonzero_cli_exit(self):
        for exit_code in (0, 2):
            for diagnostic in (
                "error: expected identifier, found keyword `ref`",
                "\\033[31merror:\\033[0m expected identifier, found keyword `type`",
            ):
                with self.subTest(exit_code=exit_code, diagnostic=diagnostic):
                    result, output = self.generate(diagnostic, exit_code)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("pub r#ref:", output)
                    self.assertIn("pub r#type:", output)

    def test_unexpected_error_is_fatal_even_when_cli_returns_zero(self):
        for exit_code in (0, 2):
            with self.subTest(exit_code=exit_code):
                result, _ = self.generate(
                    "error: expected identifier, found keyword `ref`\n"
                    "error: unexpected generator failure",
                    exit_code,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Generated and validated", result.stdout)

    def test_nonzero_exit_without_known_diagnostic_is_fatal(self):
        result, _ = self.generate(exit_code=2)
        self.assertNotEqual(result.returncode, 0)

    def test_post_repair_formatter_failure_is_fatal(self):
        result, _ = self.generate(
            "error: expected identifier, found keyword `ref`", format_exit=2,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Generated and validated", result.stdout)

    def test_missing_module_cannot_report_success(self):
        result, _ = self.generate(missing_module=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Generated and validated", result.stdout)


if __name__ == "__main__":
    unittest.main()
