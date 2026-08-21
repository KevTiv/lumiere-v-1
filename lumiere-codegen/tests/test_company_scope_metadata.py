#!/usr/bin/env python3
"""Validate the hand-authored nested company-scope annotations.

The metadata deliberately contains only nested/company provenance. Organization
injection remains owned by the reducer contract manifest. When a canonical IR
file is available, the optional checks below verify the representative paths
against the live type definitions as well.
"""

import json
import os
import re
import unittest
from pathlib import Path


CODEGEN_DIR = Path(__file__).resolve().parents[1]
METADATA_PATH = CODEGEN_DIR / "company-scope-metadata.json"
CONTRACT_PATH = (
    CODEGEN_DIR.parent / "crates" / "stdb-client" / "src" / "generated_reducer_contract.rs"
)


def _find_ir():
    candidates = []
    configured = os.environ.get("COMPANY_SCOPE_IR_PATH")
    if configured:
        candidates.append(Path(configured))
    candidates.extend(
        [
            CODEGEN_DIR.parent / ".contracts-staging" / "ir" / "lumiere-contract-ir-v1.json",
            CODEGEN_DIR.parent.parent
            / "lumiere-contracts"
            / "ir"
            / "lumiere-contract-ir-v1.json",
        ]
    )
    return next((path for path in candidates if path.is_file()), None)


def _field_names(type_definition):
    product = type_definition.get("definition", {}).get("Product", {})
    return {
        element.get("name", {}).get("some")
        for element in product.get("elements", [])
        if element.get("name", {}).get("some") is not None
    }


class CompanyScopeMetadataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metadata = json.loads(METADATA_PATH.read_text())
        cls.reducers = {entry["name"]: entry for entry in cls.metadata["reducers"]}

    def test_policy_is_explicit(self):
        self.assertEqual(self.metadata["version"], 1)
        self.assertEqual(self.metadata["path_convention"], "canonical_schema_snake_case")
        self.assertEqual(self.metadata["path_root"], "named_operation_request")
        policy = self.metadata["policy"]
        self.assertEqual(policy["organization"]["source"], "authenticated_session")
        self.assertEqual(policy["organization"]["client_input"], "forbidden")
        self.assertEqual(
            policy["company"]["validation"], "must_belong_to_session_organization"
        )
        self.assertEqual(policy["other_ids"], "ordinary_domain_input")

    def test_representative_paths_are_exact_and_unambiguous(self):
        self.assertEqual(
            self.reducers["create_contact"]["company_paths"][0]["path"],
            ["params", "company_id"],
        )
        self.assertFalse(self.reducers["create_contact"]["company_paths"][0]["required"])
        self.assertTrue(self.reducers["create_contact"]["company_paths"][0]["nullable"])

        lead = self.reducers["create_lead"]
        self.assertEqual(lead["company_paths"], [])
        self.assertTrue(lead["asserts_no_company_parameter"])

        self.assertEqual(
            self.reducers["create_opportunity"]["company_paths"][0]["path"],
            ["params", "company_id"],
        )

        self.assertEqual(
            self.reducers["delete_company"]["company_paths"][0]["path"], ["company_id"]
        )
        self.assertTrue(self.reducers["delete_company"]["company_paths"][0]["required"])

        for reducer in self.reducers.values():
            for annotation in reducer["company_paths"]:
                self.assertTrue(annotation["path"])
                self.assertTrue(
                    all(re.fullmatch(r"[a-z][a-z0-9_]*", part) for part in annotation["path"])
                )

    def test_top_level_contract_scope_is_not_duplicated(self):
        source = CONTRACT_PATH.read_text()
        expected = {
            "create_contact": ("Some(0)", "None"),
            "create_lead": ("Some(0)", "None"),
            "delete_company": ("None", "Some(0)"),
        }
        for name, (organization, company) in expected.items():
            pattern = (
                r'ReducerContract \{ name: "'
                + re.escape(name)
                + r'".*?organization_position: '
                + re.escape(organization)
                + r', company_position: '
                + re.escape(company)
                + r','
            )
            self.assertIsNotNone(
                re.search(pattern, source, re.DOTALL),
                f"generated contract scope mismatch for {name}",
            )

    def test_live_ir_representatives_when_available(self):
        ir_path = _find_ir()
        if ir_path is None:
            self.skipTest("canonical IR not present; structural metadata checks still ran")

        ir = json.loads(ir_path.read_text())
        operations = {operation["name"]: operation for operation in ir["operations"]}
        for name in (
            "create_contact",
            "create_lead",
            "create_opportunity",
            "delete_company",
        ):
            self.assertIn(name, operations)

        contact = next(
            type_definition
            for type_definition in ir["types"]
            if "CreateContactParams" in type_definition.get("names", [])
        )
        lead = next(
            type_definition
            for type_definition in ir["types"]
            if "CreateLeadParams" in type_definition.get("names", [])
        )
        opportunity = next(
            type_definition
            for type_definition in ir["types"]
            if "CreateOpportunityParams" in type_definition.get("names", [])
        )
        self.assertIn("company_id", _field_names(contact))
        self.assertNotIn("company_id", _field_names(lead))
        self.assertIn("company_id", _field_names(opportunity))

        delete_scope = operations["delete_company"]["application"]["scope"]
        self.assertEqual(delete_scope["company"]["parameter"], "company_id")
        self.assertEqual(delete_scope["company"]["position"], 0)


if __name__ == "__main__":
    unittest.main()
