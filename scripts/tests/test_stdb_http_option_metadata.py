"""Regression tests for binding-derived HTTP Option metadata."""

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "generate-stdb-http-option-metadata.py"
SPEC = importlib.util.spec_from_file_location("option_metadata", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class OptionMetadataTests(unittest.TestCase):
    def test_identifier_conversion_matches_serializer_special_cases(self):
        for original, expected in {
            "image1920Url": "image_1920_url",
            "image128Url": "image_128_url",
            "street2": "street_2",
            "costPer1KTokens": "cost_per_1k_tokens",
            "HTTPStatus": "http_status",
            "assignedUserM2O": "assigned_user_m2o",
            "relatedUsersM2M": "related_users_m2m",
            "childTasksO2M": "child_tasks_o2m",
        }.items():
            with self.subTest(original=original):
                self.assertEqual(MODULE.snake_case(original), expected)

    def test_create_asset_only_contains_wire_fields_and_preserves_numeric_types(self):
        fields, types = MODULE.generate('''export const CreateAccountAssetParams = __t.object("CreateAccountAssetParams", {
  accountAnalyticId: __t.option(__t.u64()),
  salvageValue: __t.f64(),
  remainingAmount: __t.option(__t.f64()),
  signedCount: __t.option(__t.i64()),
});
export type CreateAccountAssetParams = __Infer<typeof CreateAccountAssetParams>;
''')
        self.assertEqual(fields["CreateAccountAssetParams"], ["account_analytic_id", "remaining_amount", "signed_count"])
        self.assertNotIn("salvage_move_id", fields["CreateAccountAssetParams"])
        self.assertEqual(types["CreateAccountAssetParams"], {
            "account_analytic_id": "u64", "remaining_amount": "f64", "signed_count": "i64",
        })

    def test_enum_nested_option_and_array_builders(self):
        fields, types = MODULE.generate('''export const UpdateParams = __t.object("UpdateParams", {
  get state() {
    return __t.option(TaskState);
  },
  companyId: __t.option(__t.option(__t.u64())),
  tags: __t.option(__t.array(__t.string())),
});
''')
        self.assertEqual(fields["UpdateParams"], ["state", "company_id", "tags"])
        self.assertEqual(types["UpdateParams"], {
            "state": "TaskState", "company_id": "option<u64>", "tags": "array<string>",
        })

    def test_removed_optional_field_is_removed_on_regeneration(self):
        _, old = MODULE.generate('''export const Params = __t.object("Params", {
  obsoleteId: __t.option(__t.u64()),
});
''')
        fields, types = MODULE.generate('''export const Params = __t.object("Params", {
  requiredId: __t.u64(),
});
''')
        self.assertIn("Params", old)
        self.assertEqual(fields, {})
        self.assertEqual(types, {})

    def test_unrecognized_option_expression_fails_instead_of_silently_omitting(self):
        with self.assertRaisesRegex(ValueError, "unsupported generated type"):
            MODULE.generate('''export const Params = __t.object("Params", {
  mystery: __t.option(makeBuilder()),
});
''')

    def test_proxy_input_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unrecognized STDB object"):
            MODULE.generate('export * from "@lumiere/contracts/generated/types";')


if __name__ == "__main__":
    unittest.main()
