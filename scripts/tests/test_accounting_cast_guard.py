"""Keep Accounting feature extraction inside the existing assertion review gate."""

import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "lint-accounting-as-unknown-as.sh"


class AccountingCastGuardTests(unittest.TestCase):
    def run_guard(self, sources):
        with tempfile.TemporaryDirectory(prefix="accounting cast guard ") as directory:
            root = Path(directory)
            (root / "accounting-client.tsx").write_text("export {}\n")
            for relative, source in sources.items():
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(source)
            return subprocess.run(
                ["bash", str(SCRIPT), str(root)], capture_output=True, text=True
            )

    def test_unreviewed_cast_cannot_escape_into_nested_feature(self):
        result = self.run_guard(
            {"features/tax/deadline.ts": "const row = input as unknown as Deadline\n"}
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("features/tax/deadline.ts:1", result.stdout)

    def test_each_cast_needs_its_own_adjacent_rationale(self):
        result = self.run_guard(
            {"features/tax.ts": "// ACC-RI-018 rationale: generated boundary\n"
             "const row = input as unknown as Deadline\n\n\n\n"
             "const other = input as unknown as Group\n"}
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("features/tax.ts:6", result.stdout)

    def test_reviewed_controller_and_feature_casts_remain_allowed(self):
        source = "// ACC-RI-018 rationale: generated boundary\nconst row = input as unknown as Row\n"
        result = self.run_guard(
            {"accounting-client.tsx": source, "features/tax.tsx": source}
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("2 rationalized casts", result.stdout)

    def test_test_fixtures_do_not_expand_production_review_scope(self):
        result = self.run_guard(
            {"features/tax.test.ts": "const fixture = input as unknown as Deadline\n"}
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
