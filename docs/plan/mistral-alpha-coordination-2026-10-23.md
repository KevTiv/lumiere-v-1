# Mistral alpha work coordination — 2026-10-23

## Scope and source

This work prepares one organization for a governed, read-only Mistral pilot.
It does not admit an external alpha or certify a Railway deployment.

- Final branch: `codex/mistral-alpha-acceptance`.
- Draft stack: [runtime #252](https://github.com/KevTiv/lumiere-v-1/pull/252) → [Railway setup #253](https://github.com/KevTiv/lumiere-v-1/pull/253) → acceptance child.
- Runtime branch: `codex/mistral-runtime-limits`; setup branch: `codex/mistral-railway-preflight`.
- Base: PR #136, `e767bf36d1c6f283ad397dcaf1343d516dbe8f2d`.
- Pinned contracts: `0.3.139`; verified archive materialized without changing the pin.
- Keep the original checkout and its unrelated changes intact.
- The user authorized commits, pushes and draft PR publication on 2026-10-23. Merges, provider completions and deployments remain outside this publication request.

## Work ownership

| Lane | Owner | Files and bounded result |
| --- | --- | --- |
| Runtime | `mistral_runtime` | Routed profile permits and deadlines; conservative provider rejection handling; durable spend result and retry safety; focused Rust tests. |
| Railway setup | `railway_provisioning` | Credential-safe preflight and reviewed provisioning plan; existing service-identity contract; deterministic script tests. No automatic remote apply. |
| Acceptance | `acceptance_audit` | Reuse the existing customer fixture correction; fail mandatory GOV00 provisioning instead of skipping; explicit acceptance matrix. |
| Integration | Coordinator | Preserve source/contract boundaries; review combined changes; run checks in sequence; report executed and blocked gates separately. |

The runtime lane owns `intelligence_router.rs`, `spend_admission.rs`, and `providers/llm.rs`.
The setup lane owns its new scripts/tests and the Mistral readiness/setup documentation.
The acceptance lane owns the bank/GOV00 browser specs and its evidence report.
Cargo manifests, locks, generated contracts and database schemas remain outside these lanes.

## PR evidence at assignment

| PR | Exact head | Evidence and remaining gate |
| --- | --- | --- |
| #135 | `71b0981fd259644a6dbb7d6e58d955dad96dae1b` | CI passed. Targeted E2E was three passes and two skips; this is not full harness browser acceptance. |
| #136 | `e767bf36d1c6f283ad397dcaf1343d516dbe8f2d` | CI passed. P0 bank reconciliation fixture failed. This is the parent implementation base. |
| #193 | `ae25dbf22b4862811bb07daf94ac4335532baf57` | CI and P0 passed. Reuse its customer fixture correction; do not duplicate its run-history implementation. |
| #226 | `b97108c4fb72a587e50d8c423a6ae90d26c7032b` | CI passed; same bank fixture failed. Responsive and accessibility acceptance remains separate. |

The 2026-10-23 disposable recovery bundle proves 509 restore tables and no new
instrumented dispatch after recovery. It does not prove live Mistral access,
normal browser consequential-action acceptance, or an existing deployed PG migration.

## Release sequence

1. Review and validate the bounded draft stack in dependency order: runtime, setup, then acceptance.
2. Resolve exact-head gates for #135, then #136. Preserve their dependency order.
3. Review #193 and #226 independently; do not treat source availability as deployed acceptance.
4. After explicit release approval, build one application commit with matching contract/module/image provenance.
5. Restore Railway authentication. Inventory actual services, logs, regions, volumes, schema and migration state before any deployment.
6. Review a pilot manifest and the emitted provisioning plan. Verify identities, grants, immutable price snapshots and the active certified skill release.
7. Deploy through the existing ordered release workflow with AI explicitly enabled.
8. Run the dedicated authenticated `report_analysis` pilot and inspect durable attempts, output decisions, steps and spend.
9. Execute denial, budget, stale approval, cancellation, lost-reply and restart/reconnect gates before wider admission.

## Constraints and deferred work

- Keep the first pilot on direct Mistral, with no shadows and no configured retries.
- Cross-provider fallback remains blocked by agent-provider spend binding. It requires a separate reviewed contract/source change.
- Profile limits are process-local. Multiple gateway replicas need a reviewed aggregate limit or a single replica for this bounded pilot.
- Provider account/region instances, persistent per-profile reasoning effort, broader multimodal support and provider-hosted tools remain separate work.
- Document/RAG alpha additionally depends on #232 and #250 plus retrieval/access/revocation acceptance.
- A green health/readiness route is not proof of chat model access or spend settlement.

## Validation record

- All three implementation lanes returned changes, and the runtime lane received an independent read-only review with no actionable finding.
- The combined CI Node selector ran 20 tests: 12 new preflight tests and eight existing identity-bootstrap tests. All passed, with no skips.
- Gateway `cargo fmt -p ai-gateway -- --check` and combined `git diff --check` passed.
- Cargo manifests, lockfiles, the release manifest and contract pin are unchanged.
- Playwright discovery selected authentication setup plus the bank and GOV00 cases (three tests). Filter checks passed. Existing dependency symlinks were used; their contracts differ from this base. This is parse/selection evidence only.
- Ten new Rust regressions are present. The attempted focused offline package test exited before compilation because `pulldown-cmark` is absent from the registry cache, required while resolving the API-server workspace member. Rust compilation and execution are not verified.
- The Data volume had about 323 MiB free before validation. The user approved removal of exactly 768 redundant compiler-object outputs with matching retained library archives (2,714,002,624 logical bytes). No source, library archive, registry cache or other output was removed. Free space remained low afterward (about 507 MiB at the last check).
- Railway returned `UNAUTHORIZED` and requires reauthentication. No live provisioning, model catalog request, provider completion, browser execution or deployment ran.
- The user authorized publication after local preparation. Runtime and setup changes were committed and pushed as draft PRs #252 and #253; this acceptance child carries the remaining test and evidence changes. No merge or deployment is included.

Do not replace unexecuted live gates with unit, discovery, instrumented-provider or setup results.

## Next required actions

1. Provide sufficient build space and registry access, then run `cargo test --locked -p ai-gateway --bin gateway` against this exact branch. Review failures before release.
2. Install this branch's frozen frontend dependencies. Execute the corrected bank spec in the normal disposable seeded stack, then the applicable P0 gate.
3. Review the published draft stack and its exact-head CI. Merge and deployment still require the user's explicit approval.
4. Restore Railway authentication and complete target inventory; fill the reviewed manifest with exact target configuration and secret references through the existing owner.
5. Execute the authorized live pilot and every applicable gate in the acceptance matrix. Cross-provider routing, document/RAG, and broader chat acceptance remain separate work.
