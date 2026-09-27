# Proposed first reviewed agent capability entries

**Status: proposal awaiting review. No code or generated artifact changes with
this document.** The allowlist stays empty until a reviewer accepts entries
here; accepting them is the review step
[`agent_capabilities.rs`](../../lumiere-codegen/src/agent_capabilities.rs) exists
to gate, not a formality.

## Why this is needed now

`lumiere-codegen/agent-capability-metadata.json` is `{"version": 1,
"entries": []}` by design: "intentionally empty until an operation or resource
has been reviewed for agent exposure." Everything downstream is therefore empty
too, and that blocks the harness stack:

- The generated artifact has 0 entries, so `ToolRegistry::generated_specs()`
  returns no tools.
- A governed agent loop can advertise nothing, so the H6 pilot
  ([`ai-harness-completion-plan.md`](./ai-harness-completion-plan.md)) cannot
  run a real ERP agent.
- The only alternatives are worse: hand-written per-tool JSON Schemas in the
  gateway are forbidden by H3 ("do not add implementation-local schemas to each
  ERP tool"), and the existing harness skills reach their data through
  hand-written contracts issuing raw SQL (`low_stock.rs` queries `product` and
  `stock_quant` directly), which is exactly what the plan replaces with "named,
  typed, scope-bound data services".

So the first reviewed entries decide what a governed agent can see at all.

## What the reviewer is accepting

For each entry, the generator copies the canonical resource or operation
descriptor from the contract IR into the published artifact, and the runtime
treats the entry as the authorization to expose that target to a model. The
reviewer therefore accepts four things per entry: the **target**, the **risk
class**, whether a call **requires confirmation**, and the **result policy**
caps.

Codegen enforces the mechanics, not the judgement:

- exactly one target, either `operation_id` (a locked `erp.*` id that must be a
  session-exposed, non-internal reducer) or `resource` (an IR resource whose
  query is `classified` with `server-enforced` authorization);
- `capability_key` lowercase `[a-z0-9._-]`, unique, entries sorted by key;
- `draft`, `business_mutation` and `financial_mutation` risk must set
  `requires_confirmation: true`;
- result-policy caps must be nonzero.

## Proposed first batch: read-only, matching the existing low-stock pilot

These three resources are what `low_stock.rs` already reads through raw SQL
today, so exposing them adds no new data reach — it moves an existing read onto
the reviewed, typed path. All are reads, so all are `read_only` with no
confirmation, and each uses a `dataset` policy because the model receives rows.

| `capability_key` | target resource | IR scope | risk | confirmation | result policy |
| --- | --- | --- | --- | --- | --- |
| `inventory.products.read` | `products` | organization | `read_only` | no | `dataset`, 100 rows, 64 KiB |
| `inventory.stock-locations.read` | `stock-locations` | organization + company | `read_only` | no | `dataset`, 100 rows, 64 KiB |
| `inventory.stock-quants.read` | `stock-quants` | organization + company | `read_only` | no | `dataset`, 100 rows, 64 KiB |

(The table is in `capability_key` order, which is also the order the file must
be written in.)

Why these caps:

- **100 rows** is the row limit the promoted low-stock manifest already enforces
  (`ExecutionLimits { max_rows: 100, .. }`), so the reviewed path inherits the
  cap a reviewer already accepted rather than inventing a new one.
- **64 KiB** bounds one tool result well below the 256 KiB certification output
  ceiling (`MAX_CERTIFICATION_OUTPUT_BYTES`), leaving room for several results
  in one transcript.

What this batch deliberately does not include:

- **No operations.** Every operation target is a reducer, i.e. a mutation. Any
  agent-initiated mutation belongs behind the action-draft approval path, so the
  first batch is reads only.
- **No financial or HR resources.** `account-*`, `payroll`, `employees` and
  similar stay closed until there is a reason and a reviewer for each.
- **No aggregate-first policy.** `aggregate_first` would let the model see only
  shaped aggregates instead of rows, which is the better long-term default for
  broad tables, but it needs the allowed shapes defined per resource. Rows with
  a hard cap are the honest starting point.

Field-level exposure is *not* decided here. Each resource contract carries its
own `mandatory` and `default_restricted` field lists, and runtime field
permissions still apply, so a capability entry authorizes the resource, not the
columns.

## What follows once this is accepted

1. Write the accepted entries into `lumiere-codegen/agent-capability-metadata.json`.
2. Complete H2's remaining half: emit the tool name, description and input JSON
   Schema for each entry so `GeneratedCatalog::specs()` can build real
   `ToolSpec`s instead of failing closed with "provider name, description, and
   JSON Schema are not present". Publish and pin as v0.3.46.
3. Then the governed endpoint and the answer gate (AIH-15 core) have real tools
   to authorize, and the H6 pilot becomes buildable.

Step 2 can be built against fixtures while this review is open, since an empty
allowlist keeps the artifact empty and changes no behavior.

## Open questions for the reviewer

1. Is `products` + `stock-quants` + `stock-locations` the right first batch, or
   should the pilot be narrower still (for example `stock-quants` only, with
   product names resolved server-side)?
2. Are 100 rows and 64 KiB per result the caps you want as the default for
   `read_only` dataset capabilities?
3. Who is the recorded reviewer for these entries, and do you want the review
   metadata (reviewer, date) captured in this document, in the manifest, or
   both? The manifest schema has no reviewer field today; the existing skill
   manifests carry `ReviewMetadata` in code.
