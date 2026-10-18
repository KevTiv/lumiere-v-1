import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]


class ContractReleaseWorkflowTests(unittest.TestCase):
    def test_prepared_publish_does_not_regenerate_contracts(self):
        result = subprocess.run(
            ["make", "-n", "publish-contracts-prepared", "VERSION=9.9.9"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertIn('bash scripts/publish-contracts.sh "9.9.9"', result.stdout)
        for unexpected in (
            "generate-module-contract.mjs",
            "schema-snapshot.sh",
            "generate-spacetimedb-rust-sdk.sh",
            "generate-spacetimedb-ts-sdk.sh",
            "cargo run -p lumiere-codegen",
        ):
            self.assertNotIn(unexpected, result.stdout)

    def test_release_and_ci_share_the_module_build_workflow(self):
        release = (ROOT / ".github/workflows/release-contracts.yml").read_text()
        ci = (ROOT / ".github/workflows/ci.yml").read_text()
        shared = (ROOT / ".github/workflows/build-contracts-module.yml").read_text()

        workflow_call = "uses: ./.github/workflows/build-contracts-module.yml"
        self.assertIn(workflow_call, release)
        self.assertIn(workflow_call, ci)
        self.assertNotIn("cargo build --manifest-path spacetimedb/Cargo.toml", release)
        self.assertNotIn("cargo build --manifest-path spacetimedb/Cargo.toml", ci)
        self.assertIn("make contracts-module-ci", shared)
        self.assertIn("actions/upload-artifact@v4", shared)

    def test_release_uses_prepared_staging_and_cached_candidate_checks(self):
        release = (ROOT / ".github/workflows/release-contracts.yml").read_text()
        publisher = (ROOT / "scripts/publish-contracts.sh").read_text()

        self.assertIn('make publish-contracts-prepared VERSION="$VERSION"', release)
        self.assertNotIn('make publish-contracts VERSION="$VERSION"', release)
        self.assertIn("target/contracts-release/npm-cache", release)
        self.assertIn("cargo check --quiet --all-features", publisher)
        self.assertIn('--cache "$CONTRACTS_NPM_CACHE_DIR"', publisher)


if __name__ == "__main__":
    unittest.main()
