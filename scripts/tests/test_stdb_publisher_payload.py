import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class PublisherPayloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.module = self.root / "module.wasm"
        self.module.write_bytes(b"reviewed module including deployment policy")
        self.digest = hashlib.sha256(self.module.read_bytes()).hexdigest()
        self.revision = "a" * 40
        self.image = "ghcr.io/kevtiv/lumiere-v-1-spacetimedb-publisher@sha256:" + "b" * 64
        docker = self.root / "docker"
        docker.write_text(
            "#!" + sys.executable + "\n"
            "import json,os,sys\n"
            "with open(os.environ['REQUESTS'],'a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')\n"
            "if sys.argv[1]=='pull': pass\n"
            "elif sys.argv[1:3]==['image','inspect']:\n"
            " print(os.environ['MODULE_LABEL'] if 'module-sha256' in sys.argv[4] else os.environ['REVISION_LABEL'])\n"
            "elif sys.argv[1]=='create': print('f'*64)\n"
            "elif sys.argv[1]=='cp':\n"
            " import pathlib\n"
            " if os.environ.get('COPY_FAIL'): raise SystemExit(1)\n"
            " pathlib.Path(sys.argv[-1]).write_bytes(pathlib.Path(os.environ['PAYLOAD_FILE']).read_bytes())\n"
            "elif sys.argv[1]=='rm': pass\n"
            "else: raise SystemExit(1)\n"
        )
        docker.chmod(0o755)
        sha = self.root / "sha256sum"
        sha.write_text(
            "#!" + sys.executable + "\n"
            "import hashlib,pathlib,sys\n"
            "print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()+'  module.wasm')\n"
        )
        sha.chmod(0o755)
        self.env = os.environ | {
            "PATH": str(self.root) + os.pathsep + os.environ["PATH"],
            "REQUESTS": str(self.root / "requests.jsonl"),
            "MODULE_LABEL": self.digest,
            "PAYLOAD_FILE": str(self.module),
            "REVISION_LABEL": self.revision,
        }

    def run_verification(self, **changes):
        return subprocess.run(
            ["bash", str(ROOT / "scripts/verify-stdb-publisher-image.sh"),
             self.image, str(self.module), self.revision],
            env=self.env | changes, capture_output=True, text=True, timeout=10,
        )

    def test_exact_revision_label_and_payload_pass_without_publisher_execution(self):
        result = self.run_verification()
        self.assertEqual(result.returncode, 0, result.stderr)
        requests = [json.loads(row) for row in (self.root / "requests.jsonl").read_text().splitlines()]
        create = next(row for row in requests if row[0] == "create")
        self.assertIn("--network", create)
        self.assertIn("none", create)
        self.assertTrue(any(row[0] == "cp" for row in requests))
        self.assertTrue(any(row[0] == "rm" for row in requests))
        self.assertFalse(any(row[0] in ["run", "start", "exec"] for row in requests))

    def test_changed_policy_artifact_cannot_reuse_same_source_revision_image(self):
        result = self.run_verification(MODULE_LABEL="c" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("do not reuse or retag", result.stderr)
        requests = (self.root / "requests.jsonl").read_text()
        self.assertNotIn('"create"', requests)

    def test_wrong_revision_or_payload_fails_closed(self):
        substitute = self.root / "substituted.wasm"
        substitute.write_bytes(b"unreviewed module despite matching labels")
        for changes in [{"REVISION_LABEL": "d" * 40}, {"PAYLOAD_FILE": str(substitute)}]:
            with self.subTest(changes=changes):
                result = self.run_verification(**changes)
                self.assertNotEqual(result.returncode, 0)

    def test_failed_copy_removes_stopped_container_without_executing_it(self):
        result = self.run_verification(COPY_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        requests = [json.loads(row) for row in (self.root / "requests.jsonl").read_text().splitlines()]
        self.assertTrue(any(row[0] == "rm" for row in requests))
        self.assertFalse(any(row[0] in ["run", "start", "exec"] for row in requests))


if __name__ == "__main__":
    unittest.main()
