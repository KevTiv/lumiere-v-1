import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class RustSdkGenerationTests(unittest.TestCase):
    def generate(self, diagnostic="", exit_code=0, format_exit=0, missing_module=False):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            wasm = directory / "module.wasm"
            wasm.write_bytes(b"fixture")
            cli = directory / "spacetime"
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
            formatter = directory / "rustfmt"
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
            env = {
                **os.environ,
                "SPACETIME_BIN": str(cli),
                "RUSTFMT_BIN": str(formatter),
                "STDB_GENERATE_WASM": str(wasm),
                "DIAGNOSTIC": diagnostic,
                "CLI_EXIT": str(exit_code),
                "FORMAT_EXIT": str(format_exit),
                "MISSING_MODULE": "1" if missing_module else "0",
                "TMPDIR": str(directory),
            }
            result = subprocess.run(
                ["bash", str(ROOT / "scripts/generate-spacetimedb-rust-sdk.sh"),
                 str(directory / "bindings"), str(ROOT / "spacetimedb")],
                cwd=ROOT, env=env, text=True, capture_output=True, timeout=15,
            )
            module = directory / "bindings/mod.rs"
            return result, module.read_text() if module.exists() else ""

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
