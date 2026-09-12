# AI Enterprise Harness, Skill Registry, and Action Risk Plan

## Scope

Evolve the existing AI gateway into a bounded, auditable enterprise harness.
Agents use approved skills and generated shells with explicit scope and resource
allowlists. SQL and file access use the typed tenant/desktop capability brokers
defined in
[`ai-unified-execution-capabilities-subagent-plan.md`](./ai-unified-execution-capabilities-subagent-plan.md);
agents never receive unrestricted tenant data, shared-database SQL authority,
secrets, process filesystem access, or unreviewed network access.

Evidence-backed answers and the human intellectual foundations of generated work
follow the [completion plan's shared contract](./ai-harness-completion-plan.md#7-evidence-intellectual-provenance-and-knowledge-contract)
and [M0–M9 acceptance gates](./ai-harness-completion-plan.md#milestones-and-acceptance-criteria).
This includes original authorship, discussion contributions, claims/decisions,
component lineage, reviewed knowledge and source-change handling. Flat citations,
successful execution or skill certification alone do not establish domain
correctness. These proposed requirements remain deferred from first core
deployability under the active core plan; no implementation completion is implied.

Base M0–M7 now include durable questions/steering, diagnostic repair, non-progress
detection, checked compaction and session interrupt/resume/compare. Later M8/M9
admit bounded specialists and typed lifecycle extensions independently; disabled
optional capabilities do not block the single-agent base. These adaptations and
their OpenCode source references are recorded in completion-plan §8.

The control-plane architecture is further bounded by
[`ai-harness-t3-control-plane-adoption.md`](./ai-harness-t3-control-plane-adoption.md):
record accepted intent before external effects, isolate provider instances behind
adapters, negotiate environment capabilities explicitly, resume run streams from
durable sequence cursors, and model complex agent output as reviewable ERP
proposal workspaces rather than pretending committed ERP state is Git-revertible.

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

The current H5 stack also establishes the beginnings of a stronger durable
execution boundary: atomic spend reservations/settlement, exact run/request to
draft correlation, replay-safe step append/completion, and retained reservations
for ambiguous timeout cases. The next control-plane work must generalize those
properties to provider/tool side effects rather than create a second competing
execution model.

## 2. Proposed Architecture

Create `packages/ai-harness/` as the portable policy/type package (or Rust
equivalent shared only where required) and make the gateway the sole execution
authority. The logical components are:

```txt
intent-router -> policy-engine -> data-scope-resolver -> skill-registry
-> shell-generator -> accepted-intent/effect-boundary -> sandbox/tool runner
-> privacy-guard -> report-composer -> action-draft/proposal bridge
-> audit/projector
```

Provider work is normalized separately:

```txt
agent loop
  -> provider selector
  -> authorized ProviderInstance
  -> ProviderAdapter
  -> external provider
```

Normal flow:

```txt
user request
-> classify intent
-> resolve organization/company/user scope
-> select existing skill or generate constrained shell
-> authorize planned call
-> persist accepted intent / idempotency receipt
-> commit
-> effect reactor executes approved provider/tool capability
-> persist result | failure | outcome-unknown
-> privacy/evidence gates
-> compose answer/report/PDF/action draft/proposal workspace
-> audit/project run projection
```

The shell is declarative: allowed datasets/resources, typed inputs/outputs, max
rows/tokens/tool calls, query AST or named data operation, risk level, masking,
and expiry. It is not user/model-provided executable code.

A provider response ending the model turn is not the same as the run being fully
settled. Evidence validation, artifact persistence, draft creation, spend
settlement and ambiguous effect reconciliation may continue after the agent
portion becomes settled.

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
6. Add a durable accepted-intent/effect boundary for provider calls and
   consequential external tools. Persist stable effect IDs and command receipts
   before external I/O; execute through a reactor/worker after commit; feed
   success/failure/unknown outcomes back through durable commands/events. Do not
   blindly redispatch an uncertain effect after reconnect/restart.
7. Split provider **driver** from provider **instance**. A driver owns protocol
   normalization; an instance owns organization/account/credential/endpoint/
   region/capability/pricing lifecycle. Selection must bind the run to the exact
   authorized instance and preserve it in audit/history.
8. Add an authorized, generated/versioned harness descriptor containing contract
   release, capability-registry hash, environment identity, admitted feature
   flags and provider capability summaries. Descriptor state is compatibility
   discovery only; every operation remains reauthorized.
9. Persist monotonically ordered run events/steps suitable for resumable
   subscriptions. The server accepts an `afterSequence` cursor and returns only
   committed state after that cursor. Reconnect never implies mutation replay.
10. Extend action-draft orchestration with an `AiProposalWorkspace`-equivalent
   aggregate for coherent multi-artifact/multi-draft proposals. Workspaces may
   checkpoint/fork/compare proposed state, but posted ERP effects remain outside
   workspace rollback and require explicit correction/reversal reducers.

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
4. Add a shared harness client runtime that owns one connection/subscription
   scope per environment, stores projection state with its replay cursor, resumes
   subscriptions after reconnect, and keeps transport health distinct from data
   freshness. Individual React views consume this runtime instead of owning
   competing reconnect loops.
5. Drive feature visibility from the authoritative harness descriptor. Missing
   or removed capabilities hide/deny corresponding UI paths; client version or
   stale cache cannot infer that an environment supports a feature.
6. Surface run settlement phases distinctly: provider/agent work may be done
   while evidence, artifacts, spend or effect reconciliation is still settling.
   Never stream a candidate answer as validated final output before the answer
   gate passes.
7. Add proposal-workspace inspect/compare/fork UI for complex agent work. Each
   consequential draft keeps its own approval status and correction semantics.

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

A proposal workspace may group several amber/red drafts for review, but it cannot
merge their authority: each effect still requires its own current permission,
approval, expected watermark and correction contract.

## 7. Permissions and Audit Requirements

- Every harness decision emits a correlation ID and audit sequence: requested,
  intent classified, scope resolved, skill/shell selected, resources accessed,
  privacy transformation, artifact created, draft/approval/execution outcome.
- Authorization is checked at the BFF, policy engine, resource service, and
  reducer. No layer trusts a company ID, allowed reducer, tool, or role supplied
  by the browser/model.
- Shells have no process filesystem or unrestricted network capability. They may
  use approved tenant-object and desktop-host operations through scoped,
  auditable grants. Secrets remain server-side references and cannot be loaded
  into prompts or artifacts.
- Enforce retention and encrypted/policy-restricted access to run prompts,
  outputs, artifacts, and failure diagnostics.
- External side effects require a durable accepted-intent/effect receipt before
  dispatch. An acknowledgement of that receipt means intent committed, not that
  the external effect completed.
- `outcome_unknown` is a durable state. Reconciliation or operator review must
  resolve it before dependent consequential work resumes.
- Provider credentials, account state and mutable catalog/session state belong to
  the selected server-side provider instance; they are never supplied by the
  browser/model.
- Harness/environment descriptors and provider capability manifests never grant
  permission. They only describe compatible/admitted surfaces; invocation still
  passes current policy and scope checks.

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
6. Crash after accepted intent commits but before dispatch; restart executes the
   effect at most once and records the result against the original effect ID.
7. Simulate timeout/disconnect after dispatch where completion is uncertain;
   record `outcome_unknown`, reconcile, and prove restart does not blind-retry.
8. Configure two instances of one provider driver and prove credentials,
   mutable session/catalog state, region policy and spend selection do not leak
   across instances.
9. Disconnect a transcript consumer after sequence N, append later events,
   reconnect from N and converge without duplicate/missed rows; descriptor
   downgrade removes stale UI capability state.
10. Fork/revert a proposal workspace and prove proposal lineage/checkpoints
    change while already-posted ERP state remains untouched and still requires an
    explicit correction/reversal operation.

## 9. Risks / Open Questions

- Decide whether policy and registry data live wholly in SpacetimeDB or require
  a platform control plane for global skill review.
- Define prompt/output retention and whether customer data may leave the region
  used by the model provider.
- Clarify whether developer-only SQL analysis is needed in production; the
  simplest secure launch excludes it completely.
- Determine approval quorum/delegation and unavailable-approver handling for
  financial red actions.
- Decide which external tools require effect receipts/reconciliation versus
  being safe deterministic reads that can simply be repeated.
- Define the minimal provider-instance lifecycle contract for local/offline and
  customer-managed deployments without centralizing customer credentials.
- Keep descriptor/version compatibility simple enough that old persisted run
  history remains decodable after frontend/server upgrades and downgrades.

## Suggested Implementation Order

1. Define manifest, scope, risk, policy, audit and capability schemas; inventory
   existing skills/tools/routes.
2. Introduce intent/policy/scope/privacy layers around green read-only skills and
   finish H5 durable budget/draft persistence release+pin work.
3. Add H5c durable accepted-intent/effect orchestration and ambiguous-outcome
   reconciliation before using the H6 pilot as the reference execution model.
4. Add H5d provider driver/instance isolation, normalized adapters and capability
   truth before provider-backed pilot admission.
5. Build registry draft/version/fixture/promotion workflow and evidence/answer
   gates; admit the `low_stock` pilot only against its declared matrix.
6. Build sequence-based run streaming/shared frontend runtime and the harness
   descriptor before claiming robust web/desktop/local reconnect compatibility.
7. Adapt current action drafts to the risk matrix and introduce amber flows;
   extend AIH-24 with proposal workspaces before complex multi-draft flows.
8. Add only red actions with reviewed corrections, approval E2E, and segregation
   of duties. Keep all other red intents denied.

## Milestones and Acceptance Criteria

- Normal users can execute only reviewed skills with a deterministic scope and
  resource manifest.
- Every result and action draft carries skill/version/policy/scope/audit data.
- No AI path has unrestricted SQL or cross-tenant/company data access.
- A promoted skill can be fixture-tested, disabled, rolled back, and forensically
  traced without deleting historical executions.
- No external consequential effect occurs before its accepted intent is durable;
  duplicate/restarted execution is idempotent and uncertain outcomes reconcile.
- Provider-backed runs are bound to an explicit authorized provider instance and
  preserve the effective driver/model/region/capability/pricing decision.
- Candidate model completion is distinguishable from fully settled run state.
- Clients can resume committed run history from a durable sequence cursor and
  cannot infer unavailable capabilities from their own version or stale cache.
- Complex agent proposals can checkpoint/fork/compare without inheriting action
  approval or pretending posted ERP state can be workspace-reverted.

## Security and Privacy Considerations

Policy defaults deny. Use least-privilege resource contracts, bounded outputs,
field masking, approval for sensitive exports, and signed/correlation-linked
audit data. Generated shells are data, not executable code; raw AI HTML and
provider secrets are never accepted as trusted artifacts. Provider/account state
is instance-owned server state, environment capability discovery does not grant
authority, and reconnect/resume cannot silently replay mutations.
