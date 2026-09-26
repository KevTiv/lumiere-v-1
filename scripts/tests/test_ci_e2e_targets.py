import importlib.util
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


if __name__ == "__main__":
    unittest.main()
