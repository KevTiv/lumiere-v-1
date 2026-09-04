import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


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


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "frontend/web/.next").mkdir(parents=True)
        (self.root / "frontend/web/public").mkdir(parents=True)
        (self.root / "scripts").mkdir()
        for file in ("Cargo.toml", "Cargo.lock", "Makefile", "scripts/build-fingerprint.py", "scripts/e2e-dx.sh"):
            (self.root / file).write_text(file)
        (self.root / "frontend/package.json").write_text("{}")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.write_exe("cargo", '#!/bin/sh\nif [ "$1" = metadata ]; then d="${CARGO_TARGET_DIR:-target}"; case "$d" in /*) ;; *) d="$PWD/$d";; esac; printf \'{"target_directory":"%s"}\n\' "$d"; else printf "%s\\n" "$*" >> "$MOCK_LOG"; fi\n')
        self.write_exe("rustc", "#!/bin/sh\necho rustc-test\n")
        self.write_exe("node", "#!/bin/sh\necho node-test\n")
        self.write_exe("pnpm", '#!/bin/sh\nif [ "$1" = exec ] && [ "$2" = next ]; then n=$(cat "$MOCK_COUNT" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$MOCK_COUNT"; echo "build-$n" > .next/BUILD_ID; else exit 2; fi\n')
        self.env = os.environ | {"PATH": f"{self.bin}:{os.environ['PATH']}", "E2E_DX_ROOT": str(self.root), "MOCK_LOG": str(self.root / "cargo.log"), "MOCK_COUNT": str(self.root / "count")}
        self.env.pop("CI", None)
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
        self.assertIn("-p api-server --bin api-server --locked", (self.root / "cargo.log").read_text())
        self.assertEqual(self.invoke("api-binary", env=self.env | {"CARGO_TARGET_DIR": "custom-target"}).stdout.strip(), str(self.root / "custom-target/debug/api-server"))

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
