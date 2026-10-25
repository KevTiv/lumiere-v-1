import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


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


class TargetPlanTests(unittest.TestCase):
    def broad_sources(self):
        return {
            **SOURCES,
            **{f"{E2E}/importer-{index:02}.spec.ts": 'import { signIn } from "./helpers"\n'
               for index in range(module.MAX_TARGETED_SPECS + 1)},
        }

    def test_broad_helper_retains_only_explicitly_changed_existing_fixtures(self):
        fixtures = [f"{E2E}/work-board-{name}.spec.ts"
                    for name in ("concurrency", "delegation", "revocation", "rollback")]
        sources = {**self.broad_sources(), **{path: '// @dev-fixture\n' for path in fixtures}}
        result = module.plan_targets([f"{E2E}/helpers-legacy.ts", *fixtures,
                                      fixtures[0], f"{E2E}/removed.spec.ts"], sources)
        self.assertEqual(result, {
            "specs": "", "count": "0",
            "fallback_configs": [{"suite": "targeted", "clear_db": "0", "slot": "changed-1",
                                  "specs": " ".join(path.removeprefix("frontend/web/") for path in fixtures)}],
        })

    def test_broad_helper_alone_or_with_deleted_spec_keeps_plain_p0_fallback(self):
        for deleted in ([], [f"{E2E}/removed.spec.ts"]):
            with self.subTest(deleted=deleted):
                self.assertEqual(module.plan_targets([f"{E2E}/helpers-legacy.ts", *deleted],
                                                     self.broad_sources()),
                                 {"specs": "", "count": "0", "fallback_configs": []})

    def test_live_provider_only_edits_keep_p0_without_an_empty_targeted_lane(self):
        for path in module.LIVE_PROVIDER_ONLY_SPECS:
            with self.subTest(path=path):
                sources = {**self.broad_sources(), path: '// @ai-live\n'}
                for changed in ([path], [f"{E2E}/helpers-legacy.ts", path]):
                    self.assertEqual(module.plan_targets(changed, sources),
                                     {"specs": "", "count": "0", "fallback_configs": []})

    def test_mixed_live_and_non_live_file_keeps_its_ordinary_coverage(self):
        path = f"{E2E}/ai-human-review-provenance.spec.ts"
        result = module.plan_targets([path], {path: '// @p0 and @ai-live cases\n'})
        self.assertEqual(result, {"specs": "tests/e2e/ai-human-review-provenance.spec.ts",
                                  "count": "1", "fallback_configs": []})

    def test_no_e2e_change_has_no_supplemental_batches(self):
        self.assertEqual(module.plan_targets(["docs/plan.md"], SOURCES),
                         {"specs": "", "count": "0", "fallback_configs": []})

    def test_targeted_cap_is_inclusive(self):
        specs = [f"{E2E}/fixture-{index:02}.spec.ts" for index in range(module.MAX_TARGETED_SPECS)]
        result = module.plan_targets(specs, {path: "// @dev-fixture\n" for path in specs})
        self.assertEqual(result, {
            "specs": " ".join(path.removeprefix("frontend/web/") for path in specs),
            "count": str(module.MAX_TARGETED_SPECS), "fallback_configs": [],
        })

    def test_supplemental_batches_are_bounded_complete_and_unique(self):
        specs = [f"{E2E}/fixture-{index:02}.spec.ts" for index in range(2 * module.MAX_TARGETED_SPECS + 2)]
        result = module.plan_targets([*reversed(specs), specs[0], f"{E2E}/removed.spec.ts"],
                                     {path: "// @dev-fixture\n" for path in specs})
        self.assertEqual((result["specs"], result["count"]), ("", "0"))
        batches = result["fallback_configs"]
        self.assertEqual([batch["slot"] for batch in batches], ["changed-1", "changed-2", "changed-3"])
        self.assertEqual([len(batch["specs"].split()) for batch in batches], [25, 25, 2])
        self.assertEqual([path for batch in batches for path in batch["specs"].split()],
                         [path.removeprefix("frontend/web/") for path in specs])
        self.assertTrue(all(batch["suite"] == "targeted" and batch["clear_db"] == "0"
                            and "shard" not in batch for batch in batches))

    def test_github_output_serializes_supplemental_configs_as_json(self):
        sources = self.broad_sources()
        changed = [f"{E2E}/helpers-legacy.ts", f"{E2E}/standalone.spec.ts"]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "github-output"
            stdout = io.StringIO()
            with mock.patch("sys.argv", ["ci-e2e-targets.py", "--base", "base", "--github-output", str(output)]), \
                    mock.patch.object(module, "changed_paths", return_value=changed), \
                    mock.patch.object(module, "e2e_sources", return_value=sources), redirect_stdout(stdout):
                module.main()
            result = json.loads(stdout.getvalue())
            fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
            self.assertEqual((fields["specs"], fields["count"]), ("", "0"))
            self.assertEqual(json.loads(fields["fallback_configs"]), result["fallback_configs"])
            self.assertEqual(len(result["fallback_configs"]), 1)


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
