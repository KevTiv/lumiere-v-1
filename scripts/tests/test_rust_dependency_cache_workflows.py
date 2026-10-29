"""Keep dependency snapshots tied to successful compilation of their target."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]


def job(workflow, name):
    source = (ROOT / ".github/workflows" / workflow).read_text()
    match = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  [\w-]+:|\Z)", source, re.M | re.S)
    if match is None:
        raise AssertionError(f"missing job {name} in {workflow}")
    return match.group(1)


def step(source, name):
    for block in re.split(r"(?=^      - )", source, flags=re.M):
        if re.match(rf"      - name: {re.escape(name)}\n", block):
            return block
    raise AssertionError(f"missing step {name}")


def value(source, key):
    match = re.search(rf"^\s+{re.escape(key)}: ([^\n]+)$", source, re.M)
    if match is None:
        raise AssertionError(f"missing {key}")
    return match.group(1).strip()


class RustDependencyCacheWorkflows(unittest.TestCase):
    def setUp(self):
        self.ci = job("ci.yml", "rust")
        self.e2e = job("e2e-smoke.yml", "build-e2e")

    def test_native_jobs_share_platform_namespace_and_workspace(self):
        self.assertEqual(value(self.ci, "runs-on"), "ubuntu-24.04")
        self.assertEqual(value(self.ci, "runs-on"), value(self.e2e, "runs-on"))
        ci_cache = step(self.ci, "Restore native Rust dependencies")
        e2e_cache = step(self.e2e, "Restore native Rust dependencies")
        self.assertEqual(value(ci_cache, "shared-key"), value(e2e_cache, "shared-key"))
        self.assertTrue(value(ci_cache, "shared-key").startswith("workspace-native-dev-deps-v2-"))
        for cache in (ci_cache, e2e_cache):
            self.assertEqual(value(cache, "workspaces"), ".")

    def test_wasm_cache_cannot_reserve_the_native_namespace(self):
        cache = step(self.e2e, "Restore WASM Rust dependencies")
        self.assertTrue(value(cache, "shared-key").startswith("workspace-wasm-deps-v2-"))
        self.assertEqual(value(cache, "workspaces"), "spacetimedb")
        self.assertEqual(self.e2e.count("uses: Swatinem/rust-cache@v2"), 2)

    def test_failed_or_cancelled_jobs_cannot_publish_dependency_snapshots(self):
        for source, names in (
            (self.ci, ("Restore native Rust dependencies",)),
            (self.e2e, ("Restore native Rust dependencies", "Restore WASM Rust dependencies")),
        ):
            # Swatinem's post hook otherwise permits publication on failure.
            self.assertNotRegex(source, r"CACHE_ON_FAILURE\s*[:=]\s*['\"]?true")
            for name in names:
                cache = step(source, name)
                self.assertEqual(value(cache, "cache-on-failure"), "false")
                self.assertEqual(value(cache, "cache-workspace-crates"), "false")
                self.assertEqual(value(cache, "cache-bin"), "false")
                self.assertNotIn("add-rust-environment-hash-key: false", cache)
                self.assertIn("steps.rust-dependency-environment.outputs.image", cache)

    def test_artifact_hits_never_initialize_an_empty_dependency_snapshot(self):
        for domain, lookup, cache_name, compile_name in (
            ("wasm", "Restore compiled E2E module", "Restore WASM Rust dependencies", "Compile E2E module"),
            ("api", "Restore compiled E2E API binaries", "Restore native Rust dependencies", "Compile and validate E2E API binaries"),
        ):
            cache = step(self.e2e, cache_name)
            compile_step = step(self.e2e, compile_name)
            condition = (
                "steps.e2e-build-cache.outputs.cache-hit != 'true' && "
                f"steps.e2e-{domain}-cache.outputs.cache-hit != 'true'"
            )
            self.assertEqual(value(cache, "if"), condition)
            self.assertEqual(value(compile_step, "if"), condition)
            self.assertLess(self.e2e.index(step(self.e2e, lookup)), self.e2e.index(cache))
            self.assertLess(self.e2e.index(cache), self.e2e.index(compile_step))

    def test_verified_api_binaries_are_saved_before_frontend_can_fail(self):
        compile_step = step(self.e2e, "Compile and validate E2E API binaries")
        save = step(self.e2e, "Save compiled E2E API binaries")
        frontend = step(self.e2e, "Build exact-commit E2E artifacts")
        self.assertIn('python3 scripts/e2e-api-cache.py stage "$EXPECTED_API_FINGERPRINT"', compile_step)
        self.assertEqual(value(save, "if"), value(compile_step, "if"))
        self.assertLess(self.e2e.index(compile_step), self.e2e.index(save))
        self.assertLess(self.e2e.index(save), self.e2e.index(frontend))


if __name__ == "__main__":
    unittest.main()
