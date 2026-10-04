import importlib.util
import os
import subprocess
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("ci_e2e_targets", Path(__file__).parents[1] / "ci-e2e-targets.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

E2E = "frontend/web/tests/e2e"

SOURCES = {
    f"{E2E}/helpers.ts": 'export * from "./helpers-legacy"\n',
    f"{E2E}/helpers-legacy.ts": "export function signIn() {}\n",
    f"{E2E}/purchasing-order-fixtures.ts": 'import { signIn } from "./helpers"\n',
    f"{E2E}/cov05.spec.ts": 'import { a } from "./purchasing-order-fixtures"\n',
    f"{E2E}/cov05b.spec.ts": 'import { b } from "./purchasing-order-fixtures"\nimport { c } from "./helpers"\n',
    f"{E2E}/sales.spec.ts": 'import { signIn } from "./helpers"\n',
    f"{E2E}/standalone.spec.ts": 'import { expect } from "@playwright/test"\n',
}


class SelectSpecsTests(unittest.TestCase):
    def test_changed_spec_is_selected(self):
        self.assertEqual(module.select_specs([f"{E2E}/cov05.spec.ts"], SOURCES), [f"{E2E}/cov05.spec.ts"])

    def test_non_e2e_changes_select_nothing(self):
        self.assertEqual(module.select_specs(["spacetimedb/src/lib.rs", "docs/plan.md"], SOURCES), [])

    def test_fixture_change_selects_its_importers(self):
        self.assertEqual(
            module.select_specs([f"{E2E}/purchasing-order-fixtures.ts"], SOURCES),
            [f"{E2E}/cov05.spec.ts", f"{E2E}/cov05b.spec.ts"],
        )

    def test_shared_helper_change_selects_transitive_importers(self):
        self.assertEqual(
            module.select_specs([f"{E2E}/helpers-legacy.ts"], SOURCES),
            [f"{E2E}/cov05.spec.ts", f"{E2E}/cov05b.spec.ts", f"{E2E}/sales.spec.ts"],
        )

    def test_deleted_spec_is_ignored(self):
        self.assertEqual(module.select_specs([f"{E2E}/removed.spec.ts"], SOURCES), [])

    def test_parent_relative_import_resolves(self):
        sources = {
            f"{E2E}/shared/util.ts": "export const x = 1\n",
            f"{E2E}/nested/a.spec.ts": 'import { x } from "../shared/util"\n',
        }
        self.assertEqual(module.select_specs([f"{E2E}/shared/util.ts"], sources), [f"{E2E}/nested/a.spec.ts"])


class TargetedMakeRecipeTests(unittest.TestCase):
    def run_targeted_arguments(self, specs, require_ai):
        # Exercise the production stanza through Make and Bash so escaping and
        # array boundaries are covered, not just a copied selection rule.
        root = Path(__file__).resolve().parents[2]
        lines = (root / "Makefile").read_text().splitlines(keepends=True)
        start = next(index for index, line in enumerate(lines) if 'read -r -a SPEC_FILES' in line)
        end = next(
            index for index in range(start + 1, len(lines))
            if lines[index].lstrip().startswith("elif ")
        )
        recipe = (
            "witness:\n"
            "\t@/bin/bash -c 'set -euo pipefail; PW_ARGS=(--workers 1); \\\n"
            + "".join(lines[start:end])
            + '\tprintf "ARG=%s\\n" "$${PW_ARGS[@]}"\'\n'
        )
        env = {
            **os.environ,
            "E2E_SPEC_FILES": specs,
            "E2E_REQUIRE_AI": require_ai,
        }
        env.pop("MAKEFLAGS", None)
        env.pop("MFLAGS", None)
        return subprocess.run(
            ["make", "--silent", "--no-print-directory", "-f", "-", "witness"],
            input=recipe, cwd=root, env=env, text=True, capture_output=True, timeout=10,
        )

    def test_explicit_fixture_specs_are_not_filtered_or_lost(self):
        specs = [
            "tests/e2e/cov21-approval-decision.spec.ts",
            "tests/e2e/cov22-form-publish-import-commit.spec.ts",
        ]
        for require_ai in ("0", "1"):
            with self.subTest(require_ai=require_ai):
                result = self.run_targeted_arguments(" ".join(specs), require_ai)
                self.assertEqual(result.returncode, 0, result.stderr)
                args = [
                    line.removeprefix("ARG=") for line in result.stdout.splitlines()
                    if line.startswith("ARG=")
                ]
                live_filter = ["--grep-invert", "@ai-live"] if require_ai == "0" else []
                self.assertEqual(args, ["--workers", "1", *live_filter, *specs])

    def test_targeted_suite_requires_named_specs(self):
        result = self.run_targeted_arguments("", "0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires E2E_SPEC_FILES", result.stderr)


if __name__ == "__main__":
    unittest.main()
