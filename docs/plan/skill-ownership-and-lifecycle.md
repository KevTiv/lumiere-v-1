# Skill ownership and lifecycle

Current policy — 2026-11-17.

## Repository-owned skills

Skills shipped in `erp-skills/` with the application's supported execution
adapters are application features. Creating or updating them in the repository,
or changing harness code, takes effect with the deployed application.

They do **not** require:

- tenant skill-version creation;
- source-hash manifest refreshes or per-code-change skill-version bumps;
- certification jobs, certification runtime registration, or passing certificates;
- skill-release promotion, activation, or tenant skill-release rollback.

Built-in discovery reports `managedBy: "application"`,
`certificationRequired: false` and `activationRequired: false`. It exposes the
deployed execution policy, not a source-bound tenant publication template.
The development seed registers catalog entries and examples without fabricating
built-in version or active-release rows.

Deployment and ordinary software checks remain the delivery mechanism. Tests
still validate prompt packages, typed contracts, permissions, and evidence
behavior; they no longer compare generated certification proposals or seed
hashes to every change in shared Rust source.

Existing catalog identities are still used for durable runs and organization
configuration. Permission checks, explicit disablement, model/provider setup,
data access, spend admission, output verification and consequential-action
approvals remain enforced. None of these is a certificate-activation requirement.
Adding a new native execution capability still requires implementing its adapter;
adding a Markdown file cannot grant arbitrary tool execution.

## User-created skills

An organization-authored, non-system skill outside the reserved built-in
namespace uses the user-facing lifecycle:

1. Create the skill and save an immutable version.
2. Save examples and run the supported executor's certification/draft tests.
3. Review and activate/publish the version.
4. Run the exact published version under current actor/company permissions.
5. Create and test another version to update it, or use the governed rollback
   flow.

The current user-authored executor is `json_projection_v1`. This separation
does not silently enable arbitrary uploaded code, model-authored tools or new
executors.

Native reducers apply the ownership rule to version creation, publication and
rollback as well as certification. Knowledge-to-skill promotion cannot use a
repository-owned key to enter the tenant lifecycle. Historical rows are retained
for inspection, not treated as a requirement for running built-ins.

## Legacy diagnostics

Historical certification adapters and evidence readers remain available for old
records and isolated regression replay. Their content hashes and compatibility
versions are diagnostic identities, not deployment gates. They must not be
updated manually just because application source changes.

The removed `finance-skill-manifests.py` helper and checked-in built-in proposed
manifests belonged to the old deployment model. Older plans mentioning those
commands or requiring activation of committed skills are superseded by this
document. Application-owned skills need no certificate. Shipping changed Rust
code still requires the ordinary application/module deployment.

## Verification for this refactor

- `cargo test -p ai-gateway -p lumiere-policy-core --locked`: 1,033 gateway unit
  tests, 27 finance contract integration tests and 19 policy-core tests passed;
  13 gateway environment-dependent tests remained ignored.
- The repository-skill regression covers report, inventory, distributor,
  generation and finance adapters with no certificate or release queries.
  Disabled/inactive/foreign catalog entries still fail closed.
- `cargo test -p ai-gateway
  wire_contract_tests::web_route_forwards_current_gateway_discovery --locked --
  --ignored`: passed using Node 25.2.1. This checks the real BFF proxy, not a
  browser walkthrough.
- `cargo test --manifest-path spacetimedb/Cargo.toml --locked
  ai::skill_registry::tests`: 10 native unit tests passed.
- `cargo test --manifest-path spacetimedb/Cargo.toml --locked
  ai::knowledge_promotion::tests`: four native unit tests passed, including
  rejection of repository-owned targets even for legacy manifests.
- `cargo check --manifest-path spacetimedb/Cargo.toml --locked`: passed,
  including the development seed.
- `python3 -B scripts/erp_skill_catalog.py --check`: passed.
- Scoped Rust formatting and `git diff --check`: passed.

No production deployment, live provider request, certificate mutation or
historical-row deletion was performed. The user-facing browser workflow has not
been re-run end to end in this refactor.
