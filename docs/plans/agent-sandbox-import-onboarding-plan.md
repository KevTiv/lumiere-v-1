# Agent sandbox import and historical-data onboarding plan

**Status:** Proposed — sandbox-assisted import/onboarding architecture 2026-08-24
**Tracks:** `historical-import`, `csv`, `excel`, `sandbox-analysis`, `import-recipes`, `data-mapping`, `validation`, `preview`, `staged-ingestion`
**Related:** [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-generated-erp-tool-surface-plan.md](./agent-generated-erp-tool-surface-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md)

---

## 1. Objective

Use the Lumiere sandbox architecture as the default adaptive preparation layer for onboarding historical organization data from messy user-supplied files such as:

```text
CSV
XLS/XLSX
multi-sheet workbooks
exported reports
legacy ERP/accounting extracts
manually maintained spreadsheets
```

The sandbox may inspect, normalize, map, validate, reconcile, and stage imported data, but **must never become an alternative ERP write path**.

Target flow:

```text
user uploads historical files
        ↓
Scaleway Object Storage / FileAsset
        ↓
ImportTask
        ↓
ephemeral Daytona sandbox
        ↓
Python inspection + transformation
        ↓
ImportRecipe + ValidationReport + NormalizedImportArtifact
        ↓
user/agent review and ambiguity resolution
        ↓
typed ImportProposal
        ↓
server authorization + import policy + STDB reducers
        ↓
ERP state + audit + correction/reconciliation metadata
```

The purpose is to make onboarding adaptable to real customer data without requiring Lumiere to predict every source format in advance.

---

## 2. Core principles

1. **Messy source data belongs in the sandbox, not model context.** Raw rows stay inside the isolated execution environment unless a small policy-approved sample is explicitly required for ambiguity resolution.
2. **The model interprets structure and proposes transformations.** Python performs actual parsing, profiling, normalization, joins, deduplication, validation, and conversion.
3. **IR defines the target ERP contract.** Generated entity/field/action metadata provides the authoritative destination vocabulary for mappings.
4. **Sandbox output is a proposal, never authority.** Only normal server-side import reducers can mutate STDB.
5. **Every transformation is reproducible.** Persist the program, source fingerprint, mapping, runtime profile, validation report, and resulting artifacts.
6. **Successful onboarding work may become reusable.** Repeated successful mappings can become `ImportRecipe` records and later reviewed skills/connectors.
7. **User correction is valuable training/evaluation signal.** Corrections improve future recipe retrieval and mapping quality without silently changing ERP business rules.
8. **Imports fail closed.** Unknown mappings, broken referential integrity, unsupported states, or unresolved duplicates remain staged rather than guessed into production data.

---

## 3. File lifecycle

Uploaded historical files should be durable artifacts outside the sandbox.

```text
Browser / desktop client
        ↓
FileAsset / FileVersion
        ↓
Scaleway Object Storage
        ↓
ImportSourceRef
        ↓
short-lived scoped sandbox mount / materialization
```

The sandbox must not become the canonical storage location for uploaded source files.

Persist at minimum:

```ts
interface ImportSource {
  id: ImportSourceId
  organizationId: OrganizationId
  fileAssetRef: FileAssetRef
  contentHash: string
  mimeType: string
  originalName: string
  uploadedAt: string
  sourceSystemHint?: string
}
```

Source files remain immutable/versioned for reproducibility and audit.

---

## 4. Sandbox runtime profile

Use the general sandbox provider boundary from the sandbox architecture, with Daytona as the preferred initial implementation.

Suggested runtime profile:

```text
lumiere-import-python:v1
├── Python
├── Polars
├── PyArrow
├── openpyxl
├── pandas only where compatibility requires it
├── python-dateutil
├── decimal/currency helpers
├── charset/delimiter detection
├── Lumiere import SDK
└── no unrestricted network / ERP credentials
```

Model-authored code should prefer the Lumiere SDK and Polars/Arrow primitives.

Conceptual usage:

```python
from lumiere import imports
import polars as pl

source = imports.open_source("import_source_42")
workbook = imports.inspect_workbook(source)

customers = pl.read_excel(source.path, sheet_name="Customers")

profile = imports.profile(customers)
imports.emit_profile(profile)
```

Source paths are sandbox-scoped handles/materializations, not durable host paths.

---

## 5. Import discovery phase

The first sandbox pass should answer structural questions before mapping anything:

```text
What files/sheets/tables exist?
What encoding/delimiter/formula behavior is present?
What looks like a header row?
What columns and types exist?
Which columns contain mostly null/constant values?
What candidate identifiers exist?
What candidate entities are present?
What relationships appear across sheets/files?
What source-system patterns are recognizable?
What obvious quality problems exist?
```

Produce a bounded `ImportProfileArtifact`:

```ts
interface ImportProfileArtifact {
  sourceRefs: readonly ImportSourceId[]
  discoveredTables: readonly DiscoveredTable[]
  candidateEntities: readonly CandidateEntity[]
  candidateRelations: readonly CandidateRelation[]
  qualityIssues: readonly ImportQualityIssue[]
  sourceSystemCandidates: readonly SourceSystemCandidate[]
  provenanceRef: ProvenanceRef
}
```

The model receives structural summaries, counts, schemas, and bounded examples when policy permits — not entire raw files.

---

## 6. Mapping against generated ERP contracts

Use generated Lumiere IR metadata to discover target entities, fields, relationships, lifecycle/state constraints, and import-capable operations.

```text
source column/sheet
        ↓
agent searches generated entity metadata
        ↓
candidate target entity/field mappings
        ↓
load relevant generated schemas
        ↓
propose ImportMapping
```

Example:

```yaml
source_table: Customers
entity: crm.partner
mappings:
  Customer ID: external_reference
  Customer Name: display_name
  Email Address: email
  VAT No: tax_identifier
  Currency: preferred_currency
```

Mapping confidence should be explicit:

```ts
interface ImportFieldMapping {
  sourceField: SourceFieldRef
  targetField: GeneratedFieldRef
  confidence: number
  transform?: ImportTransformRef
  requiresUserConfirmation: boolean
}
```

Low-confidence mappings must be surfaced rather than silently accepted.

---

## 7. Python transformation responsibilities

The sandbox should be able to solve source-specific transformation problems without expanding the core ERP API for every variation.

Representative tasks:

```text
trim/normalize strings
parse mixed locale dates
parse localized decimal/currency formats
normalize country/phone/postal formats
expand merged/header rows
resolve multi-row logical records
split or merge source columns
convert source enums/statuses
normalize IDs and external references
join related sheets/files
identify duplicate candidates
convert formulas to evaluated/explicit values
remove decorative totals/subtotals
identify broken foreign references
reconstruct parent/child relationships
batch records by dependency order
```

The model may write real Python for this work, but all resulting records remain staged artifacts until validated against generated target schemas.

---

## 8. Duplicate and identity resolution

Historical imports commonly contain duplicate or conflicting entities. Treat identity resolution as a first-class stage.

Candidate match evidence may use:

```text
source external IDs
email
phone
VAT/tax identifiers
normalized names
addresses
existing ERP entity indexes
organization-approved fuzzy matching rules
```

Produce `ImportIdentityProposal` rather than mutating existing entities automatically when confidence is not deterministic.

```ts
interface ImportIdentityProposal {
  sourceRecordRef: SourceRecordRef
  candidateExistingEntities: readonly EntityMatchCandidate[]
  proposedResolution: "create" | "merge" | "link" | "review"
  confidence: number
  evidenceRefs: readonly EvidenceId[]
}
```

Financial/legal/customer master merges should require stricter thresholds and review than low-risk reference data.

---

## 9. Validation before ingestion

The sandbox should validate transformed staging data against generated ERP contracts and import-specific rules before any mutation proposal is created.

Validation classes:

```text
schema/type validity
required fields
unique/external-reference collisions
referential integrity
company/org scope
currency compatibility
period/date validity
lifecycle/status compatibility
account/product/customer references
balanced accounting structures where applicable
unsupported historical states
duplicate candidates
business-rule preconditions exposed by import contracts
```

Result:

```ts
interface ImportValidationReport {
  validRows: number
  warningRows: number
  blockedRows: number
  issuesByCode: Record<ImportIssueCode, number>
  issueArtifactRef: ArtifactRef
  proposedBatchCount: number
  canProceed: boolean
}
```

The sandbox may detect and explain business-rule problems but must not duplicate authoritative reducer validation. Final reducers revalidate on ingestion.

---

## 10. Normalized import artifacts

Successful preparation should produce durable, content-addressed staged artifacts:

```text
NormalizedImportArtifact
├── source refs + hashes
├── normalized datasets
├── target entity/schema refs
├── mapping version
├── transformation program ref
├── identity proposals
├── validation report
├── dependency/batch plan
└── provenance
```

These artifacts allow:

```text
review without rerunning parsing
retry after fixing mapping
resume onboarding later
compare revised transformations
reproduce imported data lineage
```

They live in Lumiere artifact storage/Object Storage, not inside a Daytona sandbox.

---

## 11. Import proposal and write boundary

The sandbox cannot call write reducers directly.

```text
NormalizedImportArtifact
        ↓
agent/user chooses approved mappings/resolutions
        ↓
ImportProposal
        ↓
server-derived actor/org/company context
        ↓
Casbin/import permission
        ↓
validation freshness check
        ↓
chunk/admission/idempotency policy
        ↓
normal typed STDB import reducers
        ↓
audit / correlation / correction metadata
```

`ImportProposal` should include explicit source and transformation lineage:

```ts
interface ImportProposal {
  id: ImportProposalId
  sourceRefs: readonly ImportSourceId[]
  normalizedArtifactRef: ArtifactRef
  importRecipeVersionRef?: ImportRecipeVersionRef
  targetCapabilities: readonly CapabilityKey[]
  expectedRecordCounts: Record<EntityKey, number>
  validationReportRef: ArtifactRef
  correlationId: CorrelationId
}
```

Import reducers must remain idempotent/restartable where practical so a partial large migration can safely resume.

---

## 12. Dependency ordering and batching

Historical organization imports often require ordered ingestion.

Example:

```text
reference data
  ↓
customers / suppliers
  ↓
products / accounts / taxes
  ↓
sales/purchase documents
  ↓
stock movements
  ↓
invoices / payments / journals
```

The sandbox may derive a proposed dependency graph from source/target metadata, but execution uses approved generated import capabilities.

For large imports:

```text
ImportProposal
    ↓
ImportBatch 1..N
    ↓
bounded STDB operations
    ↓
per-batch result/watermark
    ↓
resume/retry/reconcile
```

Do not treat one enormous reducer call as the default migration mechanism.

---

## 13. Preview and user review UX

The onboarding UI should expose decisions rather than implementation details.

Useful review surfaces:

```text
Detected source entities
Proposed Lumiere mappings
Unmapped columns
Low-confidence mappings
Duplicate/merge candidates
Rows blocked by validation
Expected entity counts
Example normalized records
Dependency/import order
Estimated consequences
```

Allow users to correct:

```text
column → field mapping
source enum → target enum
currency/date assumptions
identity/merge decisions
ignored rows/columns
company assignment
historical-state strategy
```

Corrections become part of the recipe/version, not ephemeral chat instructions.

---

## 14. Import recipes

A successful transformation should be persistable independently from the sandbox.

```ts
interface ImportRecipeVersion {
  id: ImportRecipeVersionId
  scope: "user" | "organization" | "reviewed"
  sourceFingerprint: ImportSourceFingerprint
  runtimeProfile: SandboxRuntimeProfileRef
  programArtifactRef: AnalysisProgramArtifactRef
  mappingArtifactRef: ArtifactRef
  targetContractVersion: ContractVersionRef
  requiredCapabilities: readonly CapabilityKey[]
  validationPolicyRef: ImportValidationPolicyRef
  outputSchemaRef: ImportArtifactSchemaRef
  metrics: ImportRecipeMetrics
}
```

Recipe matching can use:

```text
source-system hint
workbook/sheet names
column signatures
schema fingerprints
header aliases
file format
prior organization usage
```

A recipe never carries permissions; execution re-resolves current actor/org/company authority.

---

## 15. Learn from real onboarding work

Use historical onboarding as a product-discovery loop.

```text
ad-hoc sandbox transformation
        ↓
user corrections + successful import
        ↓
organization ImportRecipe
        ↓
repeated successful reuse
        ↓
reviewed import skill/template
        ↓
common cross-customer pattern
        ↓
native deterministic importer/connector
```

This allows Lumiere to discover which migrations users actually need rather than implementing speculative source connectors first.

Signals worth measuring:

```text
source formats/systems encountered
repeated source fingerprints
mapping reuse rate
user corrections per mapping
validation failure categories
common transformation code patterns
common unresolved entity concepts
average import completion time
manual intervention rate
```

Cross-organization product analytics must use privacy-safe aggregate metadata and must not expose customer data or transformation contents across tenants.

---

## 16. Skill relationship

Do not automatically promote every successful import to a skill.

Progression:

```text
one-off ImportRun
   ↓
reusable ImportRecipe
   ↓ repeated success
organization recipe
   ↓ eval/review
SkillDraft
   ↓
SkillVersion
```

A reviewed import skill can provide stable orchestration around a known source type while still relying on fresh generated contracts, current permissions, and sandbox execution.

Skills reference durable program/recipe artifacts; they must never depend on a Daytona sandbox ID or snapshot as canonical state.

---

## 17. Sandbox persistence and scaling

Use ephemeral sandboxes by default:

```text
ImportTask starts
   ↓
claim/create lumiere-import-python sandbox
   ↓
materialize authorized source files
   ↓
run inspection/transformation
   ↓
persist programs/reports/normalized artifacts
   ↓
destroy sandbox
```

Use Daytona snapshots/warm pools only for runtime optimization:

```text
approved import runtime image
   ↓ snapshot
warm pool
   ↓
fast task allocation
```

Durable state belongs in:

```text
STDB / PG
  task state
  recipe/version metadata
  proposal/audit state

Scaleway Object Storage
  uploaded sources
  normalized datasets
  Python programs
  mapping artifacts
  validation reports

Qdrant / semantic index
  derived discovery index for recipes/source fingerprints
  never canonical import state
```

---

## 18. Security and privacy

Sandbox import execution must enforce:

```text
organization/task-scoped file access only
no STDB/PG credentials
no arbitrary outbound network by default
no permanent Object Storage credentials
short-lived brokered access when storage materialization is required
CPU/RAM/disk/runtime quotas
file count/size limits
zip/archive expansion limits
malware/content-type checks before execution
no write-capability credentials
no cross-org recipe source data
```

Treat spreadsheet cell content as untrusted data, including prompt-like strings. File contents can influence transformation logic only as data, never control-plane/system instructions.

Formula execution/macros must be treated conservatively; do not execute embedded VBA/macros in the sandbox.

---

## 19. Failure and correction semantics

On failure, preserve useful state as durable artifacts rather than keeping the sandbox alive indefinitely.

Examples:

```text
parser failure
→ persist diagnostics + program

mapping ambiguity
→ persist candidate mapping + request user correction

validation failure
→ persist issue artifact + normalized staging output

partial ingestion
→ persist batch watermark + failures
→ retry remaining batches only
```

Corrections to imported ERP state must use normal correction/reconciliation operations, not silent history rewriting.

---

## 20. Evaluation corpus

Add historical-data onboarding tasks to the harness benchmark.

Representative fixtures:

```text
single clean customer CSV
messy customer workbook with merged headers
multi-sheet customer/invoice/payment workbook
mixed date/decimal locales
legacy account codes needing mapping
duplicate suppliers
broken foreign keys
large 100k+ row transaction export
source workbook with formulas
source with extra unknown columns
same source format with schema drift
partial import + retry
existing ERP data requiring identity matching
```

Measure:

```text
correct target-entity discovery
field-mapping accuracy
user correction rate
raw-data leakage to model context
valid normalized row rate
false duplicate rate
missed duplicate rate
referential-integrity success
reproducibility
recipe reuse success
schema-drift detection
import completion rate
partial-retry correctness
latency/cost
```

---

## 21. Implementation phases

### IMPORT0 — source/artifact foundation

- [ ] define `ImportTask`, `ImportSource`, `ImportSourceRef`;
- [ ] persist uploaded CSV/XLS/XLSX through `FileAsset/FileVersion` + Object Storage;
- [ ] add sandbox-safe source materialization/mounting;
- [ ] enforce file/archive/macro/security limits;
- [ ] add import runtime profile `lumiere-import-python`.

### IMPORT1 — sandbox inspection/profile

- [ ] implement workbook/CSV inspection helpers in Lumiere Python SDK;
- [ ] detect sheets/headers/schema/types/encoding/delimiters;
- [ ] emit bounded `ImportProfileArtifact`;
- [ ] identify candidate source entities/relations;
- [ ] keep raw rows out of model context by default.

### IMPORT2 — IR-backed mapping

- [ ] connect import agent to generated entity/field/relationship metadata;
- [ ] define `ImportFieldMapping` + confidence/review requirements;
- [ ] support enum/state/reference mappings;
- [ ] preserve target contract version in mapping artifacts;
- [ ] detect mapping drift after generated-contract changes.

### IMPORT3 — transformation + identity resolution

- [ ] support real Python transformations through approved sandbox profile;
- [ ] add normalization helpers for date/currency/string/reference formats;
- [ ] add duplicate/identity candidate generation;
- [ ] expose existing-ERP candidate matching through bounded read capabilities;
- [ ] require explicit review for ambiguous/high-risk merges.

### IMPORT4 — validation + normalized staging

- [ ] validate staged data against generated schemas/import contracts;
- [ ] produce `ImportValidationReport`;
- [ ] persist `NormalizedImportArtifact` + transformation program/mapping refs;
- [ ] derive dependency/batch plan;
- [ ] prove sandbox cannot invoke write reducers.

### IMPORT5 — proposal + STDB ingestion

- [ ] define typed `ImportProposal`;
- [ ] re-authorize actor/org/company scope server-side;
- [ ] execute through explicit generated import capabilities/reducers;
- [ ] make large imports resumable/idempotent where practical;
- [ ] persist per-batch watermark/results/audit;
- [ ] add preview and confirmation UX before consequential ingestion.

### IMPORT6 — reusable recipes

- [ ] define `ImportRecipe` / immutable `ImportRecipeVersion`;
- [ ] persist Python program + mapping + target-contract refs independently from sandbox;
- [ ] retrieve candidate recipes by source fingerprint;
- [ ] detect schema/source drift and fall back to re-analysis;
- [ ] record reuse success/corrections.

### IMPORT7 — skill/product feedback loop

- [ ] create eval thresholds for recipe promotion;
- [ ] support user/org reviewed recipe promotion;
- [ ] allow reviewed import skills to reference recipe/program artifacts;
- [ ] identify privacy-safe repeated cross-customer source patterns;
- [ ] use measured repeated demand to prioritize native connectors/importers.

---

## 22. Explicitly out of scope

- direct sandbox writes to STDB/PG;
- model-generated arbitrary SQL imports;
- macros/VBA execution;
- unbounded workbook/file execution;
- raw import files copied into model context;
- cross-organization reuse of customer data or mappings containing customer data;
- automatically merging high-risk master/financial entities based only on fuzzy matching;
- automatic skill promotion after a single successful run;
- treating Daytona snapshots as canonical recipe/import state;
- bypassing normal ERP reducer/business validation because staged data passed sandbox validation.

---

## 23. Acceptance criteria

The plan is successful when:

- a user can upload realistic historical CSV/Excel data without Lumiere requiring a prebuilt source-specific importer;
- the sandbox can inspect, normalize and map messy source data while keeping raw rows outside normal model context;
- mapping targets come from generated ERP contracts rather than handwritten duplicate schemas;
- ambiguous mappings/duplicates are surfaced for review instead of guessed silently;
- staged transformed data is reproducible from immutable source + program + mapping + runtime version;
- the sandbox cannot mutate ERP state directly;
- actual ingestion re-authorizes and executes only through typed STDB import reducers;
- large imports can be batched/resumed without duplicate side effects;
- successful transformations can become reusable organization recipes without persisting sandbox instances;
- repeated real customer onboarding patterns can inform reviewed skills and eventually native deterministic connectors/importers.
