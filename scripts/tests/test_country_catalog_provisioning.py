"""Structural boundaries alongside the database-backed provisioning smoke gate."""
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]


class CountryCatalogProvisioningTests(unittest.TestCase):
    def test_custom_reference_writes_still_require_superuser(self):
        source = (ROOT / "spacetimedb/src/core/reference.rs").read_text()
        for reducer in ("create_country", "create_currency"):
            body = source.split(f"pub fn {reducer}(", 1)[1].split("#[spacetimedb::reducer]", 1)[0]
            self.assertIn("require_superuser(ctx)?;", body)
            self.assertIn("check_permission(ctx, organization_id,", body)
        helper = source.split("pub(crate) fn seed_country_catalog_for_organization(", 1)[1].split("fn require_superuser", 1)[0]
        self.assertIn("crate::core::country_catalog::COUNTRIES", helper)
        self.assertNotIn(".update(", helper)
        self.assertNotIn(".delete(", helper)
        self.assertNotIn("user_profile()", helper)
        self.assertIn("existing.organization_id != organization_id", helper)
        self.assertIn("row.organization_id == organization_id && row.active", helper)

    def test_migration_checks_tenant_authority_before_installing_catalog(self):
        source = (ROOT / "spacetimedb/src/core/migrations.rs").read_text()
        body = source.split("pub fn apply_org_migrations(", 1)[1].split("/// One-shot global", 1)[0]
        self.assertLess(body.index('check_permission(ctx, organization_id, "organization", "write")?'), body.index("MIGRATION_ORG_COUNTRY_CATALOG"))
        self.assertIn("record_organization_commit", source)
        self.assertIn('"organization_code_key": row.organization_code_key', source)

    def test_private_job_does_not_use_server_token_for_mutation(self):
        source = (ROOT / "scripts/alpha-demo-seed.mjs").read_text()
        migration = source.split("if (env.SEED_PROVISION_REFERENCE_DATA === 'true')", 1)[1].split("const outcomes", 1)[0]
        self.assertIn("Authorization: `Bearer ${token}`", migration)
        self.assertNotIn("Bearer ${admin}", migration)
        self.assertIn("profiles[0].is_superuser !== false", migration)
        self.assertIn("no privileged fallback attempted", migration)

    def test_publisher_is_build_only_with_production_module_runtime_tests(self):
        workflow = (ROOT / ".github/workflows/build-production-stdb-image.yml").read_text()
        self.assertIn("uses: ./.github/workflows/build-contracts-module.yml", workflow)
        self.assertIn("test_bootstrap_new_tenant_records_complete_commit", workflow)
        self.assertIn("dev_promote_caller_superuser", workflow)
        self.assertNotIn("RAILWAY_TOKEN", workflow)
        self.assertNotIn("railway up", workflow)
        shared = (ROOT / ".github/workflows/build-contracts-module.yml").read_text()
        self.assertIn("LUMIERE_ENABLE_DEV_REDUCERS: '0'", shared)
        self.assertIn("'spacetimedb/tests/**'", shared)


if __name__ == "__main__":
    unittest.main()
