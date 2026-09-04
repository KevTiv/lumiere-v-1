import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path


spec = importlib.util.spec_from_file_location("ci_scope", Path(__file__).parents[1] / "ci-change-scope.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ChangeScopeTests(unittest.TestCase):
    def assert_domains(self, result, enabled):
        self.assertEqual(result["valid"], "true")
        for name in module.DOMAINS:
            self.assertEqual(result[f"run_{name}"], str(name in enabled).lower(), name)

    def test_docs_only(self):
        self.assert_domains(module.classify_paths(["docs/plan.md", "frontend/web/README.md"]), ())

    def test_frontend_and_docs(self):
        self.assert_domains(module.classify_paths(["frontend/packages/ui/src/button.tsx", "docs/test.md"]),
                            ("frontend", "e2e"))

    def test_service_rust(self):
        for path in ["api-server/src/main.rs", "ai-gateway/src/lib.rs", "iot-gateway/src/main.rs"]:
            with self.subTest(path=path):
                self.assert_domains(module.classify_paths([path]), ("rust", "e2e"))

    def test_shared_schema_and_unknown_are_full(self):
        for path in ["spacetimedb/src/lib.rs", "lumiere-codegen/src/main.rs", "crates/stdb-auth/src/lib.rs",
                     "api-server/build.rs", "frontend/pnpm-lock.yaml", "frontend/web/package.json",
                     "Cargo.toml", "Cargo.lock", "Makefile", ".github/workflows/ci.yml",
                     "scripts/ci-change-scope.py", "chromium-worker/src/main.rs", "assets/logo.svg",
                     "docs/data.txt", "docs/executable.mdx", "unknown.rs"]:
            with self.subTest(path=path):
                self.assert_domains(module.classify_paths([path]), module.DOMAINS)

    def test_mixed_changes(self):
        self.assert_domains(module.classify_paths(["frontend/web/app/page.tsx", "api-server/src/main.rs"]),
                            module.DOMAINS)

    def test_empty_scope(self):
        self.assert_domains(module.classify_paths([]), module.DOMAINS)

    def test_explicit_full_events(self):
        for event in ["schedule", "workflow_dispatch", "merge_group"]:
            self.assert_domains(module.event_scope(event, {}, "HEAD"), module.DOMAINS)

    def test_missing_base(self):
        for event in [{}, {"before": "0" * 40}]:
            self.assert_domains(module.event_scope("push", event, "HEAD"), module.DOMAINS)

    def test_pr_uses_base_and_selected_head(self):
        with patch.object(module, "changed_paths", return_value=["docs/plan.md"]) as changed:
            self.assert_domains(module.event_scope("pull_request", {"pull_request": {"base": {"sha": "base"}}}, "HEAD"), ())
            changed.assert_called_once_with("base", "HEAD")

    def test_null_diff_preserves_both_rename_paths_and_newlines(self):
        with patch.object(module.subprocess, "check_output", side_effect=["merge-base\n", "old\0new\nname\0"]) as command:
            self.assertEqual(module.changed_paths("base", "head"), ["old", "new\nname"])
            self.assertEqual(command.call_args.args[0],
                             ["git", "diff", "--name-only", "-z", "--no-renames", "merge-base", "head"])
