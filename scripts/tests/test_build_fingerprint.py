import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
FINGERPRINT = ROOT / "scripts" / "build-fingerprint.py"
DX = ROOT / "scripts" / "e2e-dx.sh"


def load_module():
    spec = importlib.util.spec_from_file_location("build_fingerprint", FINGERPRINT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FingerprintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for directory in ("api-server", "crates/demo", "spacetimedb/src", "frontend/web/public", "frontend/web/scripts"):
            (self.root / directory).mkdir(parents=True)
        (self.root / "scripts").mkdir()
        for file in ("Cargo.toml", "Cargo.lock", "Makefile", "scripts/build-fingerprint.py", "scripts/e2e-dx.sh"):
            (self.root / file).write_text(file)
        prepare = self.root / "scripts/prepare-vendored-contracts-rust.sh"
        prepare.write_text("#!/bin/sh\nexit 0\n")
        prepare.chmod(0o755)
        (self.root / "frontend/package.json").write_text("{}")
        self.module = load_module()

    def tearDown(self):
        self.tmp.cleanup()

    def fp(self, kind, env=None):
        return self.module.fingerprint(self.root, kind, env or {}, "tool")

    def test_scopes_are_independent_and_bindings_invalidate_api(self):
        api = self.fp("api")
        web = self.fp("frontend")
        (self.root / "frontend/web/app.tsx").write_text("frontend")
        self.assertEqual(api, self.fp("api"))
        self.assertNotEqual(web, self.fp("frontend"))
        stdb = self.fp("stdb")
        (self.root / "spacetimedb/tests").mkdir()
        (self.root / "spacetimedb/tests/fixture_test.rs").write_text("test")
        self.assertNotEqual(stdb, self.fp("stdb"))
        self.assertEqual(api, self.fp("api"))
        (self.root / ".contracts-staging/bindings").mkdir(parents=True)
        (self.root / ".contracts-staging/bindings/row_type.rs").write_text("binding")
        self.assertNotEqual(api, self.fp("api"))

    def test_frontend_includes_public_assets_lock_env_and_prefixed_env(self):
        baseline = self.fp("frontend", {"NEXT_PUBLIC_FLAG": "one"})
        for path, content in (
            ("frontend/web/public/logo.svg", "logo"),
            ("frontend/pnpm-lock.yaml", "lock"),
            ("frontend/web/.env.local", "NEXT_PUBLIC_FLAG=two"),
        ):
            (self.root / path).write_text(content)
            self.assertNotEqual(baseline, self.fp("frontend", {"NEXT_PUBLIC_FLAG": "one"}))
            baseline = self.fp("frontend", {"NEXT_PUBLIC_FLAG": "one"})
        self.assertNotEqual(baseline, self.fp("frontend", {"NEXT_PUBLIC_FLAG": "two"}))

    def test_outputs_are_ignored_and_secrets_are_not_printed(self):
        baseline = self.fp("frontend", {"NEXT_PUBLIC_FLAG": "one", "API_SECRET": "secret-value"})
        (self.root / "frontend/web/.next").mkdir()
        (self.root / "frontend/web/.next/BUILD_ID").write_text("new")
        (self.root / "target").mkdir()
        (self.root / "target/output").write_text("new")
        self.assertEqual(baseline, self.fp("frontend", {"NEXT_PUBLIC_FLAG": "one", "API_SECRET": "secret-value"}))
        env = os.environ | {"PATH": f"{ROOT / 'scripts'}:{os.environ['PATH']}", "API_SECRET": "secret-value"}
        result = subprocess.run(["python3", str(FINGERPRINT), "frontend", "--root", str(self.root)], env=env, text=True, capture_output=True, check=True)
        self.assertNotIn("secret-value", result.stdout + result.stderr)

    def test_wasm_reuses_identical_inputs_across_commits_and_checkout_paths(self):
        source = self.root / "spacetimedb/src/lib.rs"
        source.write_text("module source")
        env = {"LUMIERE_ENABLE_DEV_REDUCERS": "1", "GITHUB_SHA": "old"}
        baseline = self.fp("stdb-wasm", env)
        for name in ("frontend/web/app.tsx", "frontend/web/tests/e2e/fixture.spec.ts",
                     "frontend/web/next.config.mjs", "scripts/e2e-dx.sh",
                     "api-server/lib.rs", "spacetimedb/target/release/output.wasm"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("unrelated edit or generated output")
        os.utime(source, (1, 1))
        self.assertEqual(baseline, self.fp("stdb-wasm", env | {"GITHUB_SHA": "new"}))
        with tempfile.TemporaryDirectory() as other:
            checkout = Path(other) / "checkout"
            shutil.copytree(self.root, checkout)
            self.assertEqual(baseline, self.module.fingerprint(checkout, "stdb-wasm", env, "tool"))

    def test_wasm_source_fixtures_policies_configuration_and_removals_invalidate(self):
        inputs = (
            "spacetimedb/src/lib.rs", "spacetimedb/tests/fixture_test.rs",
            "spacetimedb/assets/pack.json", "spacetimedb/Cargo.lock",
            "spacetimedb/Cargo.toml", "spacetimedb/.cargo/config.toml",
            "crates/policy-core/src/lib.rs", "crates/presentation-core/Cargo.toml",
            "crates/stdb-auth/assets/resource_registry.json",
            "lumiere-codegen/storage-policy-manifest.json", "Cargo.toml", "Cargo.lock",
            ".cargo/config.toml", "rust-toolchain.toml", "spacetime.json",
            ".github/workflows/e2e-smoke.yml", ".github/actions/setup-spacetime-cli/action.yml",
        )
        for name in inputs:
            with self.subTest(input=name):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("before")
                original = self.fp("stdb-wasm")
                path.write_text("after")
                changed = self.fp("stdb-wasm")
                self.assertNotEqual(original, changed)
                path.unlink()
                self.assertNotEqual(changed, self.fp("stdb-wasm"))

    def test_wasm_compiler_versions_flags_and_admission_policy_invalidate(self):
        baseline = self.fp("stdb-wasm")
        for key in ("LUMIERE_ENABLE_DEV_REDUCERS", "LUMIERE_ALPHA_FOUNDER_IDENTITIES",
                    "LUMIERE_ALPHA_ADDITIONAL_TENANT_APPROVAL",
                    "LUMIERE_RECONSTRUCTION_BOOTSTRAP_IDENTITY", "RUSTFLAGS",
                    "CARGO_PROFILE_RELEASE_LTO", "SPACETIME_CLI_VERSION",
                    "BINARYEN_VERSION", "WASM_TOOLS_VERSION"):
            with self.subTest(environment=key):
                self.assertNotEqual(baseline, self.fp("stdb-wasm", {key: "changed"}))
        self.assertNotEqual(
            baseline, self.module.fingerprint(self.root, "stdb-wasm", {}, "different compiler/CLI"),
        )


class ApiCiFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.module = load_module()
        self.packages = ["api-server", "crates/stdb-auth", "lumiere-codegen",
                         "ai-gateway", "vendor/lumiere-contracts/crates/lumiere-contracts"]
        for name in (*self.module.API_CI_RECIPE, "Cargo.toml", "Cargo.lock", "api-server/build.rs",
                     "api-server/src/main.rs", "api-server/src/bin/storage-migrate.rs",
                     "crates/stdb-auth/src/lib.rs", "crates/stdb-auth/assets/resource_registry.json",
                     "lumiere-codegen/storage-policy-manifest.json",
                     "lumiere-codegen/read-descriptor-policies.json",
                     "lumiere-codegen/contract-operation-ids.json",
                     "lumiere-codegen/pg-migration-ledger/0011_durable_projection_delta.sql",
                     "vendor/lumiere-contracts-rust-0.1.0.tar.gz",
                     "vendor/lumiere-contracts-rust-0.1.0.sha256",
                     "vendor/lumiere-contracts/CONTRACT_VERSION",
                     "vendor/lumiere-contracts/VENDORED_SOURCE.json",
                     "vendor/lumiere-contracts/crates/lumiere-contracts/src/lib.rs",
                     "vendor/lumiere-contracts/manifests/storage-policy-manifest.json",
                     ".contracts-staging/bindings/row_type.rs",
                     ".contracts-staging/manifests/schema.json", ".contracts-staging/ir/PIN.json"):
            self.write(name, "input: " + name)
        for package in self.packages:
            self.write(package + "/Cargo.toml", "[package]\nname = 'fixture'\n")
        self.write("release-compatibility-manifest.json", json.dumps({
            "lumiere_contracts": {"version": "0.1.0"},
        }))
        self.env = {"RUNNER_OS": "Linux", "RUNNER_ARCH": "X64", "ImageOS": "ubuntu24",
                    "ImageVersion": "20261012.1.0", "CARGO_HOME": str(self.root / "cargo-home"),
                    "HOME": str(self.root / "home"), "PATH": os.environ["PATH"]}
        self.metadata_overrides = {}
        self.mock_tools = patch.object(self.module.subprocess, "check_output", side_effect=self.tool_output)
        self.mock_tools.start()
        self.addCleanup(self.mock_tools.stop)

    def write(self, name, contents):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents)
        return path

    def metadata(self, root, env):
        return {
            "workspace_root": str(root),
            "target_directory": str(root / env.get("CARGO_TARGET_DIR", "target")),
            "packages": [{"source": None, "manifest_path": str(root / package / "Cargo.toml")}
                         for package in self.packages],
        } | self.metadata_overrides

    def tool_output(self, command, *, cwd, env, text):
        if command[1] == "metadata":
            return json.dumps(self.metadata(Path(cwd), env))
        return "version: " + " ".join(command)

    def fp(self, env=None, tool_version="tool"):
        return self.module.fingerprint(self.root, "api-ci", self.env | (env or {}), tool_version)

    def test_reuses_across_commits_frontend_docs_specs_and_checkout_roots(self):
        baseline = self.fp()
        for name in ("frontend/web/app/page.tsx", "frontend/web/.env.local",
                     "frontend/web/tests/e2e/p0.spec.ts", "docs/api.md", "README.md",
                     "target/debug/api-server", "crates/stdb-auth/target/build/output",
                     ".ci/e2e-api/manifest.json"):
            self.write(name, "unrelated change or compiled output")
        os.utime(self.root / "api-server/src/main.rs", (1, 1))
        self.assertEqual(baseline, self.fp({"GITHUB_SHA": "new", "GITHUB_RUN_ID": "42"}))
        with tempfile.TemporaryDirectory() as other:
            checkout = Path(other) / "different" / "checkout"
            shutil.copytree(self.root, checkout)
            env = {key: value.replace(str(self.root), str(checkout)) for key, value in self.env.items()}
            self.assertEqual(baseline, self.module.fingerprint(checkout, "api-ci", env, "tool"))

    def test_sources_manifests_generated_inputs_and_recipe_changes_invalidate(self):
        baseline = self.fp()
        for name in ("Cargo.toml", "Cargo.lock", "api-server/build.rs", "api-server/src/main.rs",
                     "api-server/src/bin/storage-migrate.rs", "ai-gateway/Cargo.toml",
                     "crates/stdb-auth/src/lib.rs", "crates/stdb-auth/assets/resource_registry.json",
                     "lumiere-codegen/storage-policy-manifest.json",
                     "lumiere-codegen/read-descriptor-policies.json",
                     "lumiere-codegen/contract-operation-ids.json",
                     "lumiere-codegen/pg-migration-ledger/0011_durable_projection_delta.sql",
                     "vendor/lumiere-contracts-rust-0.1.0.tar.gz",
                     "vendor/lumiere-contracts-rust-0.1.0.sha256",
                     "vendor/lumiere-contracts/CONTRACT_VERSION",
                     "vendor/lumiere-contracts/VENDORED_SOURCE.json",
                     "vendor/lumiere-contracts/crates/lumiere-contracts/src/lib.rs",
                     "vendor/lumiere-contracts/manifests/storage-policy-manifest.json",
                     ".contracts-staging/bindings/row_type.rs", ".contracts-staging/ir/PIN.json",
                     "scripts/e2e-dx.sh", "scripts/e2e-api-cache.py", "Makefile",
                     ".github/workflows/e2e-smoke.yml", ".github/actions/prepare-contracts/action.yml"):
            with self.subTest(input=name):
                path = self.root / name
                original = path.read_bytes()
                path.write_bytes(original + b"\nchanged")
                self.assertNotEqual(baseline, self.fp())
                path.write_bytes(original)
        release = self.root / "release-compatibility-manifest.json"
        release.write_text(json.dumps({"lumiere_contracts": {"version": "0.1.0", "revision": "changed"}}))
        self.assertNotEqual(baseline, self.fp())

    def test_new_local_path_dependency_is_hashed_without_updating_a_path_list(self):
        self.packages.append("components/new-library")
        self.write("components/new-library/Cargo.toml", "[package]\nname = 'new-library'\n")
        source = self.write("components/new-library/src/lib.rs", "before")
        baseline = self.fp()
        source.write_text("after")
        self.assertNotEqual(baseline, self.fp())
        source.unlink()
        self.assertNotEqual(baseline, self.fp())

    def test_cargo_configuration_toolchain_and_compile_environment_invalidate(self):
        baseline = self.fp()
        for name in (".cargo/config.toml", "cargo-home/config.toml", "rust-toolchain.toml"):
            with self.subTest(input=name):
                path = self.write(name, "[build]\nincremental = true\n")
                self.assertNotEqual(baseline, self.fp())
                path.unlink()
        for key in ("RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_PROFILE_DEV_OPT_LEVEL",
                    "CARGO_PROFILE_DEV_DEBUG", "CFLAGS", "CPPFLAGS", "LDFLAGS",
                    "PKG_CONFIG_PATH", "OPENSSL_STATIC", "SOURCE_DATE_EPOCH",
                    "STDB_SERVER_TOKEN", "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion"):
            with self.subTest(environment=key):
                self.assertNotEqual(baseline, self.fp({key: "changed"}))
        self.assertNotEqual(baseline, self.fp(tool_version="different compiler/linker/ABI"))

    def test_external_cargo_config_contents_invalidate(self):
        with tempfile.TemporaryDirectory() as other:
            config = Path(other) / "config.toml"
            config.write_text("[build]\nincremental = true\n")
            env = {"CARGO_HOME": other}
            baseline = self.fp(env)
            config.write_text("[build]\nincremental = false\n")
            self.assertNotEqual(baseline, self.fp(env))
            config.unlink()
            self.assertNotEqual(baseline, self.fp(env))

    def test_missing_prepared_inputs_and_image_identity_fail_closed(self):
        for name in ("Cargo.lock", "api-server/Cargo.toml", "api-server/build.rs",
                     "vendor/lumiere-contracts-rust-0.1.0.tar.gz",
                     "vendor/lumiere-contracts-rust-0.1.0.sha256",
                     "vendor/lumiere-contracts/VENDORED_SOURCE.json",
                     "vendor/lumiere-contracts/manifests/storage-policy-manifest.json",
                     ".contracts-staging/bindings/row_type.rs",
                     "lumiere-codegen/storage-policy-manifest.json",
                     "crates/stdb-auth/assets/resource_registry.json"):
            with self.subTest(input=name):
                path = self.root / name
                original = path.read_bytes()
                path.unlink()
                with self.assertRaises((ValueError, OSError)):
                    self.fp()
                path.write_bytes(original)
        for key in ("RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion"):
            with self.subTest(environment=key), self.assertRaisesRegex(ValueError, key):
                self.fp({key: ""})

    def test_unsupported_output_layouts_and_compilers_fail_closed(self):
        for env in ({"CARGO_TARGET_DIR": "custom-target"}, {"CARGO_BUILD_TARGET": "wasm32-unknown-unknown"},
                    {"RUSTC_WRAPPER": "custom-rustc"}, {"CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER": "custom-ld"}):
            with self.subTest(environment=env), self.assertRaises(ValueError):
                self.fp(env)
        for content in ('[build]\ntarget = "x86_64-unknown-linux-gnu"\n',
                        '[target.x86_64-unknown-linux-gnu]\nlinker = "custom-ld"\n'):
            config = self.write(".cargo/config.toml", content)
            with self.assertRaises(ValueError):
                self.fp()
            config.unlink()

    def test_external_or_symlinked_source_inputs_fail_closed(self):
        with tempfile.TemporaryDirectory() as other:
            outside = Path(other)
            (outside / "Cargo.toml").write_text("[package]\nname='outside'\n")
            self.packages.append(str(outside))
            with self.assertRaisesRegex(ValueError, "outside the checkout"):
                self.fp()
            self.packages.pop()
            with self.assertRaisesRegex(ValueError, "staging inside the checkout"):
                self.fp({"CONTRACTS_STAGING_DIR": other})
            (outside / "source.rs").write_text("external input")
            source = self.root / "api-server/src/main.rs"
            source.unlink()
            source.symlink_to(outside / "source.rs")
            with self.assertRaisesRegex(ValueError, "ordinary checkout inputs"):
                self.fp()

    def test_cli_requires_successful_native_tool_probes_and_only_prints_the_digest(self):
        binary_dir = self.root / "bin"
        binary_dir.mkdir()
        metadata = self.write("cargo-metadata.json", json.dumps(self.metadata(self.root, self.env)))
        for tool in ("cargo", "rustc", "cc", "ld", "ldd"):
            script = '#!/bin/sh\n'
            if tool == "cargo":
                script += 'if [ "$1" = metadata ]; then cat "$MOCK_METADATA"; exit 0; fi\n'
            path = self.write("bin/" + tool, script + "echo '" + tool + " version 1'\n")
            path.chmod(0o755)
        env = self.env | {"PATH": str(binary_dir) + os.pathsep + os.environ["PATH"],
                          "MOCK_METADATA": str(metadata), "STDB_SERVER_TOKEN": "private-fixture-value"}
        command = ["python3", str(FINGERPRINT), "api-ci", "--root", str(self.root)]
        good = subprocess.run(command, env=env, text=True, capture_output=True)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertRegex(good.stdout, r"^[0-9a-f]{64}\n$")
        self.assertNotIn("private-fixture-value", good.stdout + good.stderr)
        for tool in ("cargo", "rustc", "cc", "ld", "ldd"):
            with self.subTest(tool=tool):
                path = binary_dir / tool
                original = path.read_text()
                path.write_text("#!/bin/sh\nexit 7\n")
                failed = subprocess.run(command, env=env, text=True, capture_output=True)
                self.assertNotEqual(failed.returncode, 0)
                self.assertEqual(failed.stdout, "")
                path.write_text(original)
        (binary_dir / "ldd").write_text("#!/bin/sh\nexit 0\n")
        empty_version = subprocess.run(command, env=env, text=True, capture_output=True)
        self.assertNotEqual(empty_version.returncode, 0)
        self.assertEqual(empty_version.stdout, "")


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "frontend/web/.next").mkdir(parents=True)
        (self.root / "frontend/web/public").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        for file in ("Cargo.toml", "Cargo.lock", "Makefile", "scripts/build-fingerprint.py", "scripts/e2e-dx.sh"):
            (self.root / file).write_text(file)
        prepare = self.root / "scripts/prepare-vendored-contracts-rust.sh"
        prepare.write_text("#!/bin/sh\nexit 0\n")
        prepare.chmod(0o755)
        (self.root / "frontend/package.json").write_text("{}")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.write_exe("cargo", '#!/bin/sh\nif [ "$1" = metadata ]; then d="${CARGO_TARGET_DIR:-target}"; case "$d" in /*) ;; *) d="$PWD/$d";; esac; printf \'{"target_directory":"%s"}\n\' "$d"; else printf "%s\\n" "$*" >> "$MOCK_LOG"; fi\n')
        self.write_exe("rustc", "#!/bin/sh\necho rustc-test\n")
        self.write_exe("node", "#!/bin/sh\necho node-test\n")
        self.write_exe("pnpm", '''#!/bin/sh
if [ "$1" != exec ] || [ "$2" != next ]; then exit 2; fi
n=$(cat "$MOCK_COUNT" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "$MOCK_COUNT"
echo "build-$n" > .next/BUILD_ID
mkdir -p .next/cache/turbopack
echo "compiler-cache" > .next/cache/turbopack/chunk
''')
        self.env = os.environ | {"PATH": f"{self.bin}:{os.environ['PATH']}", "E2E_DX_ROOT": str(self.root), "MOCK_LOG": str(self.root / "cargo.log"), "MOCK_COUNT": str(self.root / "count")}
        self.env.pop("CI", None)
        self.env.pop("GITHUB_ACTIONS", None)
        self.env.pop("E2E_FORCE_REBUILD", None)

    def tearDown(self):
        self.tmp.cleanup()

    def write_exe(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body if not body.startswith("#!") else body)
        path.chmod(0o755)

    def invoke(self, *args, cwd=None, env=None):
        return subprocess.run([str(DX), *args], cwd=cwd or self.root, env=env or self.env, text=True, capture_output=True, check=True)

    def test_api_build_and_metadata_target_dir(self):
        self.invoke("api-build")
        self.assertIn(
            "-p api-server --bin api-server --bin storage-migrate --locked",
            (self.root / "cargo.log").read_text(),
        )
        self.assertEqual(self.invoke("api-binary", env=self.env | {"CARGO_TARGET_DIR": "custom-target"}).stdout.strip(), str(self.root / "custom-target/debug/api-server"))

    def test_prebuilt_mode_uses_artifact_binaries_and_frontend(self):
        artifact_bin = self.root / ".ci/e2e-build/bin"
        artifact_bin.mkdir(parents=True)
        for name in ("api-server", "storage-migrate"):
            binary = artifact_bin / name
            binary.write_text("#!/bin/sh\nexit 0\n")
            binary.chmod(0o755)
        (self.root / "frontend/web/.next/BUILD_ID").write_text("artifact-build")
        env = self.env | {"E2E_PREBUILT": "1", "CI": "true", "GITHUB_ACTIONS": "true"}
        (self.root / "scripts/prepare-vendored-contracts-rust.sh").write_text("#!/bin/sh\nexit 99\n")

        self.invoke("api-build", env=env)
        self.assertEqual(self.invoke("api-binary", env=env).stdout.strip(), str(artifact_bin / "api-server"))
        self.assertEqual(self.invoke("storage-migrate", env=env).returncode, 0)
        result = self.invoke("frontend-build", env=env)
        self.assertIn("prebuilt Next.js", result.stdout)
        self.assertFalse((self.root / "count").exists())

    def test_github_actions_build_preserves_compiler_cache_and_writes_stamp(self):
        self.invoke("frontend-build", env=self.env | {"CI": "true", "GITHUB_ACTIONS": "true"})

        cache = self.root / "frontend/web/.next/cache/turbopack/chunk"
        self.assertEqual(cache.read_text().strip(), "compiler-cache")
        self.assertTrue((self.root / ".tmp/e2e/frontend.hash").is_file())

    def test_github_actions_build_without_compiler_cache_rejects_reuse(self):
        self.write_exe("pnpm", '#!/bin/sh\necho "build-without-cache" > .next/BUILD_ID\n')
        cache = self.root / "frontend/web/.next/cache/turbopack"
        stamp = self.root / ".tmp/e2e/frontend.hash"
        stamp.parent.mkdir(parents=True)
        for state in ("missing", "empty directory", "empty file"):
            with self.subTest(cache=state):
                if state != "missing":
                    cache.mkdir(parents=True, exist_ok=True)
                if state == "empty file":
                    (cache / "chunk").touch()
                stamp.write_text("previous-build")

                with self.assertRaises(subprocess.CalledProcessError) as error:
                    self.invoke("frontend-build", env=self.env | {"CI": "true", "GITHUB_ACTIONS": "true"})

                self.assertIn("without a nonempty Turbopack compiler cache", error.exception.stderr)
                self.assertFalse(stamp.exists())

    def test_frontend_reuse_identity_failure_and_ci(self):
        self.invoke("frontend-build")
        self.invoke("frontend-build")
        self.assertEqual((self.root / "count").read_text().strip(), "1")
        (self.root / "frontend/web/.next/BUILD_ID").write_text("other-build")
        self.invoke("frontend-build")
        self.assertEqual((self.root / "count").read_text().strip(), "2")
        (self.root / "frontend/web/app.tsx").write_text("changed")
        (self.root / "bin/pnpm").write_text("#!/bin/sh\nexit 1\n")
        (self.root / "bin/pnpm").chmod(0o755)
        stamp = self.root / ".tmp/e2e/frontend.hash"
        with self.assertRaises(subprocess.CalledProcessError): self.invoke("frontend-build")
        self.assertFalse(stamp.exists())
        self.write_exe("pnpm", '#!/bin/sh\nn=$(cat "$MOCK_COUNT"); n=$((n+1)); echo "$n" > "$MOCK_COUNT"; echo "build-$n" > .next/BUILD_ID\n')
        self.invoke("frontend-build", env=self.env | {"CI": "true"}, cwd=Path("/tmp"))
        self.assertEqual((self.root / "count").read_text().strip(), "3")
        self.invoke("frontend-build", env=self.env | {"CI": "true"})
        self.assertEqual((self.root / "count").read_text().strip(), "4")


if __name__ == "__main__":
    unittest.main()
