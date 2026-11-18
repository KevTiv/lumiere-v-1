import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "check_retired", Path(__file__).parents[1] / "check-retired-skill-steps.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

BANNER = "> Superseded for repository-owned skills by [x](y.md) (2026-11-17). Historical record only for those steps.\n\n"


class RetiredSkillStepsTests(unittest.TestCase):
    def check(self, files):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in files.items():
                p = root / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
            return module.violations(root)

    def test_flags_unbannered_reference(self):
        self.assertEqual(self.check({"docs/plans/a.md": "run finance-skill-manifests.py\n"}), ["docs/plans/a.md"])
        self.assertEqual(self.check({"docs/plan/b.md": "see certification-bundles\n"}), ["docs/plan/b.md"])

    def test_banner_passes(self):
        self.assertEqual(self.check({"docs/plans/a.md": BANNER + "finance-skill-manifests.py\n"}), [])

    def test_evidence_and_lifecycle_doc_exempt(self):
        self.assertEqual(self.check({
            "docs/evidence/e.md": "finance-skill-manifests.py",
            "docs/plan/skill-ownership-and-lifecycle.md": "finance-skill-manifests.py",
        }), [])

    def test_unrelated_docs_pass(self):
        self.assertEqual(self.check({"docs/plans/a.md": "nothing here\n"}), [])

    def test_repository_is_clean(self):
        self.assertEqual(module.violations(module.ROOT), [])


if __name__ == "__main__":
    unittest.main()
