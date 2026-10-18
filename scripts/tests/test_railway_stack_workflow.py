import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class RailwayStackWorkflowTests(unittest.TestCase):
    def test_release_phases_remain_ordered(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        phases = [
            "Phase 1 — gate EU infrastructure",
            "Phase 2 — publish and verify SpacetimeDB module",
            "Phase 3 — apply PostgreSQL storage migrations",
            "Phase 4 — deploy Chromium worker",
            "Phase 4 gate — Chromium readiness",
            "Phase 5 — deploy API server",
            "Phase 5 gate — API readiness",
            "Phase 6 — deploy AI gateway",
            "Phase 6 gate — AI readiness",
            "Phase 7 — deploy projection worker",
            "Phase 7 gate — projection readiness",
            "Phase 8 — deploy workflow and owner-report workers from shared runtime image",
            "Phase 8 gate — workflow and owner-report readiness",
            "Phase 9 — deploy production integration workers",
            "Phase 9 gate — production integration-worker readiness",
            "Phase 10 — deploy web",
            "Phase 10 gate — web readiness",
            "Phase 11 — deploy API gateway last",
            "Phase 11 gate — public edge readiness",
        ]
        offsets = [workflow.index(phase) for phase in phases]
        self.assertEqual(offsets, sorted(offsets))

    def test_all_topology_services_are_explicit(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        for service in (
            "Postgres",
            "qdrant",
            "spacetimedb",
            "spacetimedb-publisher",
            "storage-migrate",
            "api-server",
            "ai-gateway",
            "chromium-worker",
            "owner-report-worker",
            "workflow-worker",
            "projection-worker",
            "expense-integration-worker",
            "hr-integration-worker",
            "project-integration-worker",
            "web",
            "api-gateway",
        ):
            self.assertIn(service, workflow)

    def test_publisher_verifies_canonical_schema_shape(self):
        publisher = (ROOT / "scripts/railway-publish-spacetimedb.sh").read_text()
        for key in ("reducers", "tables", "types", "typespace"):
            self.assertIn(f'has("{key}")', publisher)
        self.assertIn('canonical_table_name == "organization"', publisher)
        self.assertIn("SpacetimeDB publish and schema verification passed", publisher)
        self.assertNotIn("sleep infinity", publisher)

    def test_downstream_services_are_not_deployed_in_the_same_phase(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        self.assertIn("Postgres spacetimedb", workflow)
        self.assertIn("gate qdrant", workflow)
        self.assertNotIn("deploy api-server ai-gateway", workflow)
        self.assertNotIn("deploy web api-gateway", workflow)
        self.assertIn("redeploy-source workflow-worker owner-report-worker", workflow)
        commands = [
            "publish-stdb spacetimedb-publisher",
            "redeploy-storage storage-migrate",
            "deploy chromium-worker",
            "redeploy-source api-server",
            "redeploy-source ai-gateway",
            "redeploy-source projection-worker",
            "redeploy-source workflow-worker owner-report-worker",
            "expense-integration-worker hr-integration-worker project-integration-worker",
            "deploy web",
            "deploy api-gateway",
        ]
        offsets = [workflow.index(command) for command in commands]
        self.assertEqual(offsets, sorted(offsets))

    def test_storage_migration_requires_positive_marker(self):
        binary = (ROOT / "api-server/src/bin/storage-migrate.rs").read_text()
        orchestrator = (ROOT / "scripts/railway-stack-release.sh").read_text()
        marker = "PostgreSQL storage migrations applied and verified successfully"
        self.assertIn(marker, binary)
        self.assertIn(marker, orchestrator)
        self.assertIn("redeploy-storage storage-migrate", (
            ROOT / ".github/workflows/release-railway-stack.yml"
        ).read_text())

    def test_runtime_image_is_pull_gated_and_promoted_atomically(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        orchestrator = (ROOT / "scripts/railway-stack-release.sh").read_text()

        self.assertIn('docker pull --quiet "$RUST_RUNTIME_IMAGE"', workflow)
        self.assertIn('org.opencontainers.image.revision', workflow)
        self.assertIn('"$image_revision" == "$RELEASE_SHA"', workflow)
        self.assertIn("Gate anonymous runtime image pull", workflow)
        self.assertIn("railway environment edit", orchestrator)
        self.assertIn('--project "$RAILWAY_PROJECT_ID"', orchestrator)
        self.assertIn('--environment "$RAILWAY_ENVIRONMENT"', orchestrator)
        self.assertIn("repo: null", orchestrator)
        self.assertIn("branch: null", orchestrator)
        self.assertIn("commitSha: null", orchestrator)
        self.assertIn("upstreamUrl: null", orchestrator)

    def test_ai_is_explicitly_disabled_by_default(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        self.assertIn("enable_ai:", workflow)
        self.assertIn("default: false", workflow)
        self.assertIn("if: inputs.enable_ai", workflow)

        topology = json.loads((ROOT / "infra/railway/production-eu-services.json").read_text())
        qdrant = next(service for service in topology["services"] if service["name"] == "qdrant")
        self.assertEqual(qdrant["featureGate"], "RAILWAY_ENABLE_AI")
        self.assertFalse(qdrant["required"])

    def test_integration_activation_requires_real_tenants(self):
        workflow = (ROOT / ".github/workflows/release-railway-stack.yml").read_text()
        self.assertIn("enable_integrations:", workflow)
        self.assertIn("RAILWAY_ENABLE_INTEGRATIONS: ${{ inputs.enable_integrations }}", workflow)
        self.assertIn("if: inputs.environment == 'production' && inputs.enable_integrations", workflow)

    def test_production_manifest_covers_exact_runtime_workers(self):
        manifest = json.loads(
            (ROOT / "infra/railway/production-eu-services.json").read_text()
        )
        services = {service["name"]: service for service in manifest["services"]}
        self.assertEqual(manifest["environment"], "production")
        self.assertEqual(manifest["expectedRegion"], "europe-west4-drams3a")
        self.assertFalse(services["ai-gateway"]["required"])
        self.assertEqual(services["ai-gateway"]["featureGate"], "RAILWAY_ENABLE_AI")
        for domain, port in (("expense", 8092), ("hr", 8094), ("project", 8093)):
            service = services[f"{domain}-integration-worker"]
            self.assertEqual(service["runtimeBinary"], f"{domain}-integration-worker")
            self.assertEqual(service["healthPort"], port)
            variables = service["requiredVariables"]
            self.assertEqual(variables[f"STDB_{domain.upper()}_WORKER_TOKEN"]["kind"], "secret")
            self.assertEqual(
                variables[f"LUMIERE_{domain.upper()}_WORKER_ORG_IDS"]["kind"],
                "positive-id-list",
            )

    def test_web_release_resolves_production_service_by_name(self):
        workflow = (ROOT / ".github/workflows/release-railway-web.yml").read_text()
        self.assertIn("RAILWAY_ENVIRONMENT: production", workflow)
        self.assertIn("RAILWAY_SERVICE_NAME: web", workflow)
        self.assertIn("railway service list", workflow)
        self.assertNotIn("23ee8acf-1b14-4b1c-b6f5-ce8fd2ed683c", workflow)


if __name__ == "__main__":
    unittest.main()
