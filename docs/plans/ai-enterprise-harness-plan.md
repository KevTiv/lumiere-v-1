# AI Enterprise Harness, Skill Registry, and Action Risk Plan

## Scope

Evolve the existing AI gateway into a bounded, auditable enterprise harness.
Agents use approved skills and generated shells with explicit scope and resource
allowlists; they never receive unrestricted tenant data, arbitrary SQL, secrets,
filesystem, or network access.

## Current Codebase References

- `ai-gateway/src/main.rs`: current `/v1/skills/run`, `/v1/actions/draft`, RAG,
  import, search, and context routes.
- `ai-gateway/src/orchestrator/run.rs` and `skill_loader.rs`: skill execution,
  database loading, configuration, and run persistence.
- `ai-gateway/src/sandbox/query.rs`: `validate_read_only_sql`; `sandbox/` also
  has session, datasets, and export modules.
- `ai-gateway/src/harness/entity_registry.rs` and `snapshot.rs`: bounded entity
  snapshot foundations; `tools/registry.rs` and `tools/action_draft.rs` supply
  tool execution.
- `spacetimedb/src/ai/skills.rs`: `AiSkill`, config, run, and run-step tables.
  `action_drafts.rs`, `action_draft_lifecycle.rs`, and `reducer_allowlist.rs`
  supply human-approved mutation foundations.
- `frontend/web/app/api/ai/_lib/route-helpers.ts`: session/org/company checks and
  payload sanitization; existing BFF routes proxy skill/action calls.

## 1. Current Codebase Evidence

The gateway is already better than free-form AI: it has loaded skills, dataset
specifications, read-only SQL validation, entity registries, tool registry, run
audit, action drafts, reducer allowlists, expiry, and approval lifecycle hooks.
However, policy decisions are distributed, skill records are mutable/unversioned,
the run route can still be understood as a generic skill execution endpoint, and
there is no canonical privacy/risk/scope contract that every AI path shares.

## 2. Proposed Architecture

Create `packages/ai-harness/` as the portable policy/type package (or Rust
equivalent shared only where required) and make the gateway the sole execution
authority. The core components are:

```txt
intent-router -> policy-engine -> data-scope-resolver -> skill-registry
-> shell-generator -> sandbox-runner -> privacy-guard -> report-composer
-> action-draft-bridge -> audit-logger
```

Flow:

```txt
user request
-> classify intent
-> resolve organization/company/user scope
-> select existing skill or generate constrained shell
-> execute through approved SDK in sandbox
-> privacy guard
-> compose answer/report/PDF/action draft
-> audit
-> optionally save as skill draft
```

The shell is declarative: allowed datasets/resources, typed inputs/outputs, max
rows/tokens/tool calls, query AST or named data operation, risk level, masking,
and expiry. It is not user/model-provided executable code.

## 3. Backend Changes

1. Add `ai-gateway/src/harness/{intent_router,policy_engine,data_scope_resolver,
skill_registry,shell_generator,sandbox_runner,privacy_guard,report_composer,
action_draft_bridge,audit_logger}.rs`; refactor existing `orchestrator`,
`sandbox`, tools, entity registry, and action draft code behind these interfaces.
   Preserve current routes during a compatibility transition.
2. Add BFF routes following existing protection patterns:
   `frontend/web/app/api/ai/intent/route.ts`, `run-skill/route.ts`,
   `report/render/route.ts`, and `action-draft/route.ts`. They must use
   `requireAiRouteContext`, `validateCompanyScope`, typed payload validation, and
   no client-provided privilege escalation. Map legacy `/skills/run` and
   `/actions/draft` gradually.
3. Replace arbitrary SQL as the normal skill primitive with named, typed,
   scope-bound data services. Keep `validate_read_only_sql` only for tightly
   controlled developer/admin analysis, with parsed AST/allowlisted views, row
   caps, timeouts, and no write/DDL/export capability.
4. Add policy records for intent, role permission, risk, approved resources,
   output types, maximum scope, masking strategy, required approval, and
   correction/rollback requirement. Default deny unknown intents/skills.
5. Add a privacy guard that transforms results before prompt composition and
   response persistence. It masks phone/payment references by default, suppresses
   fields denied by policy, limits rows/columns, removes secrets, and rejects
   cross-company source rows.

## 4. Frontend Changes

1. Retain `frontend/web/app/(modules)/ai-harness/page.tsx`, `ai-skills`, and
   `ai-action-drafts` as entry points, but render typed intent state, allowed
   scope, risk label, citations, masking, job state, artifact links, and audit
   correlation rather than a generic chat outcome.
2. Add skill draft/review/version pages to the AI Skills module and a red-action
   preview/diff/approval drawer reusing `ai-action-draft-diff-panel.tsx`.
3. Add a scope selector that only lists session-authorized companies and uses
   compact report/action forms. Do not expose tool, SQL, secret, or raw shell
   controls to normal operators.

## 5. Skill Registry and Promotion Workflow

Extend `AiSkill` rather than treating bundled markdown files as the complete
registry. Add immutable `AiSkillVersion`, `AiSkillDraft`, `AiSkillFixture`,
`AiSkillTestRun`, `AiSkillPromotion`, and `AiSkillRollback` records, or model
equivalent version tables. A version contains category (`reporting`, `payments`,
`inventory`, `accounting`, `messaging`, `imports`, `reconciliation`), typed input
and output schema, risk level (`green|amber|red`), required permissions, allowed
resources, output types (`answer|table|chart|pdf|action_draft`), data scope,
shell manifest, redaction policy, and tenant/global visibility.

Workflow:

1. A generated or authored proposal creates a tenant-scoped skill draft.
2. Admin/developer reviews the diff, policy, fixture inputs/expected outputs,
   required permissions, and resource allowlist.
3. Fixture test runs execute in a synthetic or approved snapshot environment.
4. Approval promotes an immutable version; tenant-specific skills remain isolated
   and global skills require platform review.
5. A rollback deactivates a version and promotes a previous compatible version;
   existing execution records retain the original version ID and artifact hash.

The existing `AiSkillConfig` remains company-specific enablement/configuration,
not a substitute for promotion/version control.

## 6. AI Action Risk Model

| Risk | Actions | Enforcement |
| --- | --- | --- |
| Green | read-only reports, summaries, low-stock scans, unpaid-invoice summaries, momo duplicate scans | approved read-only skill/shell, scoped data, privacy guard, audit; no mutation route. |
| Amber | draft payment reminder, suggest momo reconciliation, draft stock adjustment, draft purchase order, draft customer merge | typed action/message draft only, preview/diff, user can edit/reject, audit; no automatic execution. |
| Red | post invoice; register/reverse payment; bulk reconcile; permission change; delete/rollback import; close period; bulk message customers; export sensitive data | role permission, independent human approval, deterministic diff/preview, audit, and documented rollback/correction strategy are mandatory. |

For every red action, declare the target reducer, expected record version/source
watermark, scope, approval policy, separation-of-duties rule, and correction
reducer. Reuse `AiActionDraft` lifecycle and `AiReducerAllowlist`, but expand
their metadata with risk, policy/skill-version ID, diff hash, source snapshot,
required approver role, and correction plan. Do not call generic reducers from
the gateway. Existing red operations that do not have safe compensating behavior
must remain unavailable to AI.

## 7. Permissions and Audit Requirements

- Every harness decision emits a correlation ID and audit sequence: requested,
  intent classified, scope resolved, skill/shell selected, resources accessed,
  privacy transformation, artifact created, draft/approval/execution outcome.
- Authorization is checked at the BFF, policy engine, resource service, and
  reducer. No layer trusts a company ID, allowed reducer, tool, or role supplied
  by the browser/model.
- Shells have no filesystem/network process capability; only approved SDK/data
  operations are available. Secrets remain server-side references and cannot be
  loaded into prompts or artifacts.
- Enforce retention and encrypted/policy-restricted access to run prompts,
  outputs, artifacts, and failure diagnostics.

## 8. E2E Test Requirements

1. A green daily cash report resolves only the selected company, masks phone and
   reference values, and persists a run audit/artifact.
2. Attempt cross-company scope, arbitrary table, raw write SQL, large export,
   shell network/file access, and direct reducer invocation; all must be denied
   and audited.
3. An amber reconciliation/message draft shows source, diff, warnings, and can
   be rejected without ERP mutation.
4. A red payment reversal/bulk message/import rollback draft requires an eligible
   different approver, then exercises the correction strategy. Assert failure if
   approval or role is absent.
5. Promote a fixture-tested tenant skill, run it, roll back its version, and
   verify older runs keep their historical version/artifact metadata.

## 9. Risks / Open Questions

- Decide whether policy and registry data live wholly in SpacetimeDB or require
  a platform control plane for global skill review.
- Define prompt/output retention and whether customer data may leave the region
  used by the model provider.
- Clarify whether developer-only SQL analysis is needed in production; the
  simplest secure launch excludes it completely.
- Determine approval quorum/delegation and unavailable-approver handling for
  financial red actions.

## Suggested Implementation Order

1. Define manifest, scope, risk, policy, and audit schemas; inventory existing
   skills/tools/routes.
2. Introduce intent/policy/scope/privacy layers around green read-only skills.
3. Build registry draft/version/fixture/promotion workflow and migrate bundled
   skills into immutable versions.
4. Adapt current action drafts to the risk matrix and introduce amber flows.
5. Add only red actions with reviewed corrections, approval E2E, and segregation
   of duties. Keep all other red intents denied.

## Milestones and Acceptance Criteria

- Normal users can execute only reviewed skills with a deterministic scope and
  resource manifest.
- Every result and action draft carries skill/version/policy/scope/audit data.
- No AI path has unrestricted SQL or cross-tenant/company data access.
- A promoted skill can be fixture-tested, disabled, rolled back, and forensically
  traced without deleting historical executions.

## Security and Privacy Considerations

Policy defaults deny. Use least-privilege resource contracts, bounded outputs,
field masking, approval for sensitive exports, and signed/correlation-linked
audit data. Generated shells are data, not executable code; raw AI HTML and
provider secrets are never accepted as trusted artifacts.
