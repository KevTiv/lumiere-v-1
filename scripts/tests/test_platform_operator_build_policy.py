"""Persistent root enrollment must remain private and deployment-bound."""
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class PlatformOperatorBuildPolicyTests(unittest.TestCase):
    def test_policy_is_default_off_and_part_of_compiled_module_cache(self):
        workflow = (ROOT / ".github/workflows/build-contracts-module.yml").read_text()
        policy_input = workflow.split("      persistent_platform_operator:", 1)[1].split(
            "\nenv:", 1
        )[0]
        self.assertIn("default: ''", policy_input)
        self.assertIn(
            "PERSISTENT_PLATFORM_OPERATOR: ${{ inputs.persistent_platform_operator }}",
            workflow,
        )
        self.assertIn(
            '"$ALPHA_ADDITIONAL_TENANT_APPROVAL" "$PERSISTENT_PLATFORM_OPERATOR"',
            workflow,
        )
        self.assertIn(
            "${{ steps.alpha-policy.outputs.digest }}", workflow
        )
        self.assertIn(
            "LUMIERE_PERSISTENT_PLATFORM_OPERATOR: ${{ inputs.persistent_platform_operator }}",
            workflow,
        )

    def test_only_production_publisher_receives_the_approved_repository_policy(self):
        production = (ROOT / ".github/workflows/build-production-stdb-image.yml").read_text()
        self.assertIn(
            "persistent_platform_operator: ${{ vars.LUMIERE_PERSISTENT_PLATFORM_OPERATOR }}",
            production,
        )
        self.assertIn(
            '"$IMAGE_REPOSITORY@$digest" .ci/contracts-module.wasm "$IMAGE_SOURCE_SHA"',
            production,
        )
        for workflow in ("ci.yml", "release-contracts.yml"):
            with self.subTest(workflow=workflow):
                self.assertNotIn(
                    "vars.LUMIERE_PERSISTENT_PLATFORM_OPERATOR",
                    (ROOT / ".github/workflows" / workflow).read_text(),
                )

    def test_enrollment_is_not_a_tenant_dispatch_operation(self):
        exposure = json.loads((ROOT / "lumiere-codegen/reducer-exposure.json").read_text())
        entries = [
            row for row in exposure["reducers"]
            if row["name"] == "enroll_persistent_platform_operator"
        ]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["exposure"], "denied")
        self.assertIn("deployment", entries[0]["unscoped_reason"])
        contract = json.loads(
            (ROOT / "lumiere-codegen/operation-contracts/people-platform.json").read_text()
        )
        entry = contract["operations"]["enroll_persistent_platform_operator"]
        self.assertEqual(entry["semantic_kind"], "internal")
        self.assertFalse(entry["client_facing"])


if __name__ == "__main__":
    unittest.main()
