#!/usr/bin/env python3
"""Unit tests for the structural code-ownership guardrail."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("check-code-ownership.py")
SPEC = importlib.util.spec_from_file_location("check_code_ownership", SCRIPT)
assert SPEC and SPEC.loader
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class OwnershipGuardrailTests(unittest.TestCase):
    def test_modular_layout_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in CHECKER.REQUIRED_MODULE_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            self.assertEqual(CHECKER.check_repo(root), [])

    def test_retired_flat_owner_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in CHECKER.REQUIRED_MODULE_FILES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            retired = root / "api-server/src/workflow_reads.rs"
            retired.parent.mkdir(parents=True, exist_ok=True)
            retired.touch()
            errors = CHECKER.check_repo(root)
            self.assertIn("retired flat owner still exists: api-server/src/workflow_reads.rs", errors)

    def test_missing_realtime_owner_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in CHECKER.REQUIRED_MODULE_FILES:
                if relative == "api-server/src/realtime/subscription.rs":
                    continue
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            errors = CHECKER.check_repo(root)
            self.assertIn("required module owner is missing: api-server/src/realtime/subscription.rs", errors)

    def test_missing_cold_merge_owner_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in CHECKER.REQUIRED_MODULE_FILES:
                if relative == "api-server/src/cold_tier/read_descriptor.rs":
                    continue
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            errors = CHECKER.check_repo(root)
            self.assertIn(
                "required module owner is missing: api-server/src/cold_tier/read_descriptor.rs",
                errors,
            )


if __name__ == "__main__":
    unittest.main()
