"""Contract-emitter checks independent of Cargo and live STDB."""

import copy
import importlib.util
import json
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("offline_emitter", ROOT / "scripts/generate-offline-projection.py")
EMITTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EMITTER)


class OfflineProjectionTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads(EMITTER.POLICY.read_text())
        # Minimal fixture using the canonical manifest shape, not a runtime schema.
        self.table = {
            "sql_name": "product_category",
            "primary_key": {"column_name": "id", "ty": "U64"},
            "columns": [
                {"name": name, "sql_name": name, "ty": ty, "nullable": nullable}
                for name, ty, nullable in [
                    ("id", "U64", False), ("organization_id", "U64", False),
                    ("company_id", "U64", True), ("name", "String", False),
                    ("parent_id", "U64", True), ("sequence", "U32", False),
                ]
            ],
        }
        self.manifest = {"version": 1, "tables": [self.table]}

    def test_deterministic_and_scope_partitioned(self):
        actual = EMITTER.render(self.manifest, self.policy)
        self.assertEqual(actual, EMITTER.render(copy.deepcopy(self.manifest), self.policy))
        self.assertIn('PRIMARY KEY ("_lumiere_scope", "id")', actual)
        self.assertIn('id: text("id").notNull()', actual)
        self.assertIn('row.company_id === null ? null : u64(row.company_id)', actual)

    def test_unknown_types_fail_closed(self):
        self.table["columns"][3]["ty"] = "Identity"
        with self.assertRaisesRegex(ValueError, "unsupported projection type"):
            EMITTER.render(self.manifest, self.policy)

    def test_missing_fields_fail_closed(self):
        self.table["columns"].pop()
        with self.assertRaises(KeyError):
            EMITTER.render(self.manifest, self.policy)

    def test_duplicate_table_fails_closed(self):
        self.manifest["tables"].append(self.table)
        with self.assertRaisesRegex(ValueError, "exactly once"):
            EMITTER.render(self.manifest, self.policy)

    def test_identity_scope_requires_nonnullable_u64(self):
        self.table["columns"][1]["nullable"] = True
        with self.assertRaisesRegex(ValueError, "non-null U64"):
            EMITTER.render(self.manifest, self.policy)

    def test_no_unreviewed_fields_are_generated(self):
        before = EMITTER.render(self.manifest, self.policy)
        self.table["columns"].append({"name": "secret", "sql_name": "secret", "ty": "String", "nullable": True})
        self.assertEqual(before, EMITTER.render(self.manifest, self.policy))
        self.assertNotIn("secret", before)

    def test_selected_type_change_changes_schema_fingerprint(self):
        before = EMITTER.render(self.manifest, self.policy)
        self.table["columns"][4]["nullable"] = False
        after = EMITTER.render(self.manifest, self.policy)
        self.assertNotEqual(re.search(r"sha256:[a-f0-9]+", before)[0], re.search(r"sha256:[a-f0-9]+", after)[0])

    def test_sql_identifier_injection_rejected(self):
        self.policy["table"] = 'x"; DROP TABLE test; --'
        self.table["sql_name"] = self.policy["table"]
        with self.assertRaisesRegex(ValueError, "SQL identifier"):
            EMITTER.render(self.manifest, self.policy)

    def test_missing_ownership_field_rejected(self):
        self.policy["fields"].remove("organization_id")
        with self.assertRaisesRegex(ValueError, "scope fields"):
            EMITTER.render(self.manifest, self.policy)

    def test_write_projection_is_not_enabled_by_metadata(self):
        self.policy["mode"] = "read-write"
        with self.assertRaisesRegex(ValueError, "read-only"):
            EMITTER.render(self.manifest, self.policy)

    def test_server_and_client_share_fingerprint_and_selected_fields(self):
        self.table["columns"].append({"name": "deleted_at", "sql_name": "deleted_at", "ty": "Timestamp", "nullable": True})
        outputs = dict(EMITTER.render_outputs(self.manifest, self.policy))
        client = outputs[EMITTER.OUTPUT]
        server = outputs[EMITTER.RUST_OUTPUT]
        self.assertEqual(re.search(r"sha256:[a-f0-9]+", client)[0], re.search(r"sha256:[a-f0-9]+", server)[0])
        self.assertIn(", ".join([*self.policy["fields"], "deleted_at"]), server)
        self.assertNotIn('"metadata"', server)

    def test_server_requires_canonical_soft_delete_metadata(self):
        with self.assertRaisesRegex(ValueError, "canonical soft-delete"):
            EMITTER.render_outputs(self.manifest, self.policy)
        self.table["columns"].append({"name": "deleted_at", "sql_name": "deleted_at", "ty": "String", "nullable": True})
        with self.assertRaisesRegex(ValueError, "canonical soft-delete"):
            EMITTER.render_outputs(self.manifest, self.policy)


if __name__ == "__main__":
    unittest.main()
