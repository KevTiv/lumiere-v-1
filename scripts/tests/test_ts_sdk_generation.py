"""Exercise SDK publication without building WASM or changing repository assets."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
INDEX = """export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}
export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);
"""
TYPES = """export const Params = __t.object("Params", {
  companyId: __t.option(__t.u64()),
});
"""


class TypeScriptSdkGenerationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.repository = self.directory / "repository"
        scripts = self.repository / "scripts"
        scripts.mkdir(parents=True)
        for name in (
            "generate-spacetimedb-ts-sdk.sh",
            "generate-stdb-http-option-metadata.py",
            "sync-directory.py",
        ):
            shutil.copyfile(ROOT / "scripts" / name, scripts / name)
        self.bindings = self.directory / "bindings"
        self.metadata = self.repository / "frontend/packages/stdb/src"
        self.metadata.mkdir(parents=True)
        (self.metadata / "authored.ts").write_text("export const authored = true;\n")
        self.index_fixture = self.directory / "index.ts"
        self.types_fixture = self.directory / "types.ts"
        self.index_fixture.write_text(INDEX)
        self.types_fixture.write_text(TYPES)
        wasm = self.directory / "module.wasm"
        wasm.write_bytes(b"fixture")
        cli = self.directory / "spacetime"
        cli.write_text(
            "#!/bin/bash\nset -eu\n"
            'while [ "$#" -gt 0 ]; do\n'
            '  if [ "$1" = --out-dir ]; then out="$2"; shift; fi\n'
            "  shift\n"
            "done\n"
            'cp "$INDEX_FIXTURE" "$out/index.ts"\n'
            'cp "$TYPES_FIXTURE" "$out/types.ts"\n'
            'exit "$CLI_EXIT"\n'
        )
        cli.chmod(0o755)
        self.environment = {
            **os.environ,
            "SPACETIME_BIN": str(cli),
            "STDB_GENERATE_WASM": str(wasm),
            "INDEX_FIXTURE": str(self.index_fixture),
            "TYPES_FIXTURE": str(self.types_fixture),
            "TMPDIR": str(self.directory),
        }

    def generate(self, exit_code=0):
        return subprocess.run(
            ["bash", str(self.repository / "scripts/generate-spacetimedb-ts-sdk.sh"),
             str(self.bindings), str(self.directory / "module")],
            cwd=self.repository,
            env={**self.environment, "CLI_EXIT": str(exit_code)},
            text=True, capture_output=True, timeout=15,
        )

    def snapshot(self):
        return {
            path: (path.read_bytes(), path.stat().st_mtime_ns)
            for directory in (self.bindings, self.metadata)
            for path in directory.rglob("*") if path.is_file()
        }

    def test_success_repairs_types_and_publishes_matching_option_metadata(self):
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        index = (self.bindings / "index.ts").read_text()
        self.assertIn("// @ts-expect-error -- generated module size", index)
        self.assertIn("// @ts-ignore -- generated module size", index)
        self.assertEqual(json.loads((self.metadata / "stdb-http-option-types.json").read_text()),
                         {"Params": {"company_id": "u64"}})
        self.assertEqual(json.loads((self.metadata / "stdb-http-option-fields.json").read_text()),
                         {"Params": ["company_id"]})
        self.assertEqual((self.metadata / "authored.ts").read_text(),
                         "export const authored = true;\n")

    def test_regeneration_preserves_unchanged_files_and_removes_stale_apis(self):
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        unchanged_time = 1_600_000_000_123_456_789
        for path in self.snapshot():
            os.utime(path, ns=(unchanged_time, unchanged_time))
        original = self.snapshot()
        stale = self.bindings / "removed_reducer.ts"
        stale.write_text("export const removed = true;\n")

        result = self.generate()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), original)
        self.assertFalse(stale.exists())

    def test_changed_snapshot_updates_bindings_and_option_metadata(self):
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.types_fixture.write_text(TYPES.replace("__t.u64()", "__t.string()"))

        result = self.generate()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.bindings / "types.ts").read_text(), self.types_fixture.read_text())
        self.assertEqual(json.loads((self.metadata / "stdb-http-option-types.json").read_text()),
                         {"Params": {"company_id": "string"}})

    def test_failed_generation_or_validation_preserves_bindings_and_metadata(self):
        result = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        original = self.snapshot()
        cases = (
            (INDEX, TYPES, 2),
            (INDEX.replace("DbConnectionBuilder extends", "UnrecognizedBuilder extends"), TYPES, 0),
            (INDEX.replace("export const reducers =", "export const renamed ="), TYPES, 0),
            (INDEX, 'export * from "proxy";\n', 0),
            (INDEX, TYPES.replace("__t.u64()", "unknownBuilder()"), 0),
        )
        for index, types, exit_code in cases:
            with self.subTest(index=index, types=types, exit_code=exit_code):
                self.index_fixture.write_text(index)
                self.types_fixture.write_text(types)
                result = self.generate(exit_code)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshot(), original)


if __name__ == "__main__":
    unittest.main()
