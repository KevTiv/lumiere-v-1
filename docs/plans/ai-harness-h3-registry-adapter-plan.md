# H3 generated registry adapter plan

**Status:** Coordination handoff — 2026-09-12

**Parent:** H2c consumer pin, PR #20, pinned `lumiere-contracts` `v0.3.42`

**Child of:** [AI Harness Luna Execution Plan](./ai-harness-luna-execution-plan.md)
**Scope:** Adapter shell and authorization-view boundary only. No runtime
capability is admitted by this document.

## Outcome

Adapt the generated H2 capability catalog to the gateway's existing
`ToolSpec` and `ToolRegistry` seams without creating a second ERP schema,
authorization model, or execution path.

The production-safe starting state is deliberately empty: the pinned H2
artifact currently contains no reviewed entries, so it must expose zero
generated ERP `ToolSpec` values. An empty generated catalog must never fall
back to the seven local runtime-native tools; those tools remain a separate,
explicit namespace.

H3 is complete only when model-selected names resolve through an authorized
registry view. A model-selected name must not call the raw
`ToolRegistry::run_named` lookup, which currently accepts any locally known
name. H3 does not claim per-call policy, budget, durable loop, or production
ERP capability admission; those remain H4/H5 and later gates.

## Immutable H2c handoff

The coordinator must pin and verify PR #20 / `lumiere-contracts` `v0.3.42`
before H3 implementation starts. The gateway consumes the embedded generated
constant:

```text
lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_JSON
lumiere_contracts::generated::agent_capabilities::AGENT_CAPABILITY_REGISTRY_SHA256
```

The adapter parses this embedded JSON once (for example with `OnceLock`), not
from `.contracts-staging`, a package directory, a mutable filesystem path, or
the network. Initialization must fail closed when any of these checks fail:

- artifact version is unsupported;
- checksum does not match the generated sidecar constant;
- `source_ir.ir_version` is unsupported;
- `source_ir.source_dirty` is true or provenance is malformed;
- capability keys are not stable, sorted, and unique;
- an entry identifies zero or multiple targets;
- an operation target is not a locked, session-exposed, client-facing reducer;
- a resource target is not classified as server-enforced;
- result policy or risk/confirmation metadata is invalid.

The generated artifact is structural metadata. It does not grant a role,
permission, company, organization, or approval.

## Namespaces and trust boundaries

### Runtime-native namespace

The existing handwritten implementations remain separate:

```text
erp_snapshot
erp_search
analytics_summary
web_search
fetch_url
action_draft
save_artifact
```

Their implementation and reviewed provider-facing descriptions are local
gateway concerns. They are not generated ERP capabilities and must not be
replaced by, merged with, or inferred from H2 entries.

### Generated ERP namespace

Generated entries are keyed by stable `capability_key` and retain their
operation/resource target identity. The adapter may expose a descriptor to
the model only after the skill allowlist and current agent action filter have
selected it. Discovery is an ergonomic filter, never the security boundary.

At invocation, trusted execution context comes from `ToolContext`: its
`org_id`, `company_id`, actor credentials, and STDB client are authoritative.
The model may supply business parameters, but it cannot supply or override
organization/company scope fields. Every future execution adapter must inject
scope from `ToolContext` and reject conflicting model input.

Mutating, business-mutation, and financial-mutation entries remain typed
draft/approval intents. H3 must not directly execute a consequential reducer,
even when the descriptor is present and the model requests it.

## H3a — adapter shell and empty-denial proof

H3a is the first bounded slice. It must be useful with the current empty
catalog and must not require production ERP entries.

### Owned files

- `ai-gateway/src/tools/generated.rs` — new parser, checksum/provenance
  validation, descriptor types, and generated-to-`ToolSpec` conversion.
- `ai-gateway/src/tools/mod.rs` — export the generated adapter.
- `ai-gateway/src/tools/registry.rs` — keep runtime-native tools separate and
  add a catalog/descriptor surface that can return zero generated tools.
- Focused tests colocated with the adapter/registry. Synthetic JSON fixtures
  may be test-only and must not be copied into generated staging or production
  defaults.

The coordinator owns `Cargo.toml`/lockfile changes needed by the H2c pin and
all generated contract output. H3a must not edit generated artifacts by hand.

### H3a representation

Use a typed local representation for the small fields needed by registry
resolution (`capability_key`, target kind, operation/resource identity, risk,
confirmation, result policy, and the embedded structural descriptor). Preserve
the full descriptor as validated JSON where a generated schema is not yet
typed; do not reconstruct ERP operation or resource facts from local code.

The adapter converts only provider-valid descriptors to `ToolSpec`. It must
not invent per-tool JSON schemas. Current H2 operation `schema` metadata is
SATS algebraic metadata, not provider JSON Schema; composite `Ref` values do
not carry enough information for the gateway to synthesize a faithful input
schema. H3a therefore uses synthetic fixtures to prove the conversion
boundary and rejects unsupported/non-JSON-schema entries in production.

Capability keys may contain dots, while provider function-name formats may
allow only alphanumeric, underscore, and hyphen characters. H3a must either
consume a generated provider-safe name or deterministically reject/encode it
with collision and round-trip tests. It must not silently use an ambiguous
display name as the stable authorization identity.

### H3a non-goals

- no non-empty production allowlist;
- no generated resource query execution;
- no generic reducer dispatch from model input;
- no replacement of the existing runtime-native tools;
- no per-call Casbin/resource/limit authorization claim;
- no LLM loop, transcript, budget, fallback, or skill migration;
- no promotion of scoped SQL, tenant-file, desktop-file, or arbitrary network
  tools.

## H3b — authorized view and adapter handles

H3b adds the invocation-facing boundary consumed by H4. It remains a shell
until H2 emits provider-valid schemas and a separately admitted operation or
resource execution path exists.

### Required boundary

`ToolRegistry` should produce an authorized view/handle containing only:

1. explicitly allowlisted runtime-native tools;
2. explicitly allowlisted generated entries;
3. entries permitted by the current agent action filter.

The H4 loop receives this view and resolves each model `ToolCallRequest` by
name through it. Unknown, unlisted, stale, or filtered names fail before
`AgentTool::execute`. The old raw `run_named` path may remain for fixed legacy
or internal callers during the transition, but it cannot be the model-selected
path and must not be used as an authorization substitute.

For generated operation targets, the eventual adapter may use the locked
operation identity and existing generated reducer contract validation. Scope
arguments are server/context-owned. For generated resource targets, H3b may
provide discovery metadata only. It must never fall back to
`StdbClient::query_table` or broad `SELECT *`; resource execution requires a
typed, scoped, server-authorized query adapter in a later slice.

## Acceptance matrix

| Area | Required evidence | H3 status boundary |
| --- | --- | --- |
| Embedded source | Parse `AGENT_CAPABILITY_REGISTRY_JSON` once; checksum and provenance tests | H3a |
| Empty deny-by-default | Empty pinned registry produces zero generated `ToolSpec` values and does not expose the seven runtime-native tools through the generated namespace | H3a |
| Target integrity | Exactly one operation/resource target; locked/session reducer and server-enforced resource checks | H3a |
| Provider schema | Valid synthetic JSON-schema fixture converts; SATS algebraic metadata and unresolved composite refs fail closed | H3a |
| Provider names | Dotted/invalid capability keys cannot create ambiguous provider function names; collision/round-trip tests pass | H3a |
| Namespace separation | Runtime-native tools remain available only through their own reviewed registry entries; generated entries cannot shadow them | H3a |
| Allowlist/action filter | Unlisted or agent-disallowed entries are absent from the authorized view | H3b |
| Model resolution | Unknown model-selected names cannot reach raw `run_named` or `AgentTool::execute` | H3b |
| Scope authority | Model-supplied organization/company values are rejected or ignored; `ToolContext` values are injected and tested | H3b |
| Resource safety | No generated resource path emits broad `SELECT *`; unsupported resource execution fails closed | H3b |
| Mutation safety | Mutation-risk entries produce draft/approval-only outcomes and never direct reducer effects | H3b; full enforcement H5 |

Focused tests should include malformed checksum, dirty provenance, duplicate or
unsorted keys, unknown/multiple targets, missing operation lock,
non-server-enforced resources, invalid result policy, invalid provider names,
empty registry behavior, runtime/generated name collision, unlisted capability,
agent action denial, model scope override, and resource broad-query denial.

## Handoff to H4

H3 hands H4:

- a pinned-source generated catalog with explicit provenance;
- a provider-facing `ToolSpec` conversion boundary that does not hand-author
  ERP schemas;
- a distinct runtime-native namespace;
- an authorized registry view for model-selected resolution;
- synthetic conversion/denial evidence with zero production generated
  capabilities until a reviewed H2 entry has a provider-valid schema and an
  admitted execution adapter.

H4 must add the pure loop, transcript round-tripping, durable nonzero runs,
tool-result messages, malformed-call stops, and step/token caps. Those are not
H3 evidence.
