# WorkProgram certification, compatibility, and promotion plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `work-program`, `certification`, `compatibility`, `dependency-graph`, `publication`, `migration`, `promotion`, `evals`, `contract-versioning`  
**Related:** [work-program-runtime-execution-plan.md](./work-program-runtime-execution-plan.md) · [work-program-ui-harness-convergence-plan.md](./work-program-ui-harness-convergence-plan.md) · [agent-ir-codegen-extension-plan.md](./agent-ir-codegen-extension-plan.md) · [agent-performance-admission-cost-plan.md](./agent-performance-admission-cost-plan.md) · [frontend-multisurface-workflow-presentation-plan.md](./frontend-multisurface-workflow-presentation-plan.md)

---

## 1. Objective

Make reusable WorkPrograms safe to publish, version, migrate, deprecate, and promote as application contracts evolve.

The main problem to solve is that a published program may depend on generated capabilities, schemas, runtime profiles, code artifacts, research/document providers, output contracts, and UI placements that change over time.

Target model:

```text
WorkProgramDraft
     ↓
compile + static validation
     ↓
fixtures / evals / dry-run
     ↓
policy + cost + security checks
     ↓
CertificationReport
     ↓
publish immutable WorkProgramVersion
     ↓
DependencyGraph
     ↓
application/runtime change
     ↓
CompatibilityReport
  ├── compatible
  ├── migration-required
  ├── blocked
  └── deprecated
```

---

## 2. Non-negotiable invariants

1. Published versions are immutable.
2. Automations pin exact published versions.
3. Certification never grants runtime authorization; execution still re-authorizes every capability.
4. Application-contract changes must surface affected WorkPrograms before incompatible deployment where practical.
5. Runtime/provider changes must not silently alter WorkProgram semantics.
6. A program that becomes incompatible must fail closed rather than guess replacements.
7. Promotion to native deterministic capability is evidence-driven, not automatic.
8. Organization-local certification and Lumière-wide certification are distinct trust levels.

---

## 3. Publication lifecycle

Suggested states:

```ts
type WorkProgramLifecycle =
  | "draft"
  | "testing"
  | "certified-org"
  | "published"
  | "deprecated"
  | "blocked"
  | "retired"
```

Publication should require an immutable manifest:

```ts
interface WorkProgramVersionManifest {
  programVersion: WorkProgramVersionRef
  graphHash: string
  inputSchema: SchemaRef
  outputSchema: SchemaRef
  capabilityRefs: readonly CapabilityVersionRef[]
  codeArtifacts: readonly CodeArtifactVersionRef[]
  runtimeProfiles: readonly RuntimeProfileRef[]
  presentationRefs: readonly PresentationContractRef[]
  triggerCompatibility?: TriggerCompatibility
  certification: CertificationReportRef
}
```

---

## 4. Certification levels

Use explicit levels rather than one boolean `approved` flag.

```text
experimental
  developer/admin test only

organization-tested
  fixtures/dry-runs pass for one organization context

organization-approved
  authorized admin publishes for organization use

lumiere-certified
  reviewed against broader fixtures/evals/security/performance corpus
```

Not every organization-specific report needs Lumière-wide certification.

Programs with greater consequential scope should require stronger gates.

---

## 5. Certification report

```ts
interface CertificationReport {
  programVersion: WorkProgramVersionRef
  certificationLevel: CertificationLevel
  staticValidation: CheckResult
  fixtures: readonly EvalResultRef[]
  schemaCompatibility: CheckResult
  capabilityCompatibility: CheckResult
  security: CheckResult
  performance: CheckResult
  consequentialImpact?: CheckResult
  reviewer?: ActorId
  generatedAt: string
}
```

Checks should be machine-readable and inspectable in UI.

---

## 6. Fixture and eval strategy

Every reusable program should be testable without live side effects.

Representative fixture families:

```text
happy-path
empty dataset
partial/missing data
schema edge cases
large-but-bounded dataset
provider unavailable
model malformed output
permission denied
approval rejected
stale external research
incompatible capability version
```

Consequential programs additionally need:

```text
dry-run impact snapshot
idempotency proof where required
bounded batch proof
approval path proof
rollback/correction expectation
```

Do not require giant universal eval suites for simple reports; scale certification burden with program risk/cost.

---

## 7. Dependency graph

Maintain a first-class graph over reusable extensions.

```text
WorkProgramVersion
├── CapabilityVersionRef[]
├── CodeArtifactVersionRef[]
├── RuntimeProfileRef[]
├── PresentationContractRef[]
├── ResearchCapabilityRef[]
├── Document/OCR capability refs
├── TriggerDescriptor refs
└── child WorkProgram refs if composition is supported
```

The graph must support queries such as:

```text
what breaks if capability X changes?
which automations use program Y?
which programs depend on runtime profile Z?
which programs use deprecated entity field A?
which UI placements expose blocked program B?
```

This graph powers deployment checks, admin warnings, migration tooling, and product analysis.

---

## 8. Application-contract compatibility

When application-contract IR changes, classify the effect on published programs.

```ts
type CompatibilityClass =
  | "compatible"
  | "compatible-with-retest"
  | "migration-required"
  | "blocked"
```

Examples:

### Compatible

- additive optional output field;
- new capability unrelated to program;
- compatible runtime patch version.

### Compatible with retest

- performance/cost metadata changed materially;
- provider implementation changed but contract did not;
- schema constraint tightened without changing shape.

### Migration required

- field renamed/removed;
- capability input/output schema changed;
- presentation output contract changed;
- program references deprecated entity relation.

### Blocked

- required capability removed;
- required runtime profile unavailable;
- code artifact revoked;
- security policy forbids referenced dependency.

The compiler must not guess a substitute capability solely because names look similar.

---

## 9. Compatibility report and deployment gate

```ts
interface ProgramCompatibilityReport {
  programVersion: WorkProgramVersionRef
  targetContractVersion: ApplicationContractVersion
  classification: CompatibilityClass
  affectedDependencies: readonly DependencyImpact[]
  suggestedMigration?: MigrationSuggestionRef
}
```

Before deploying a contract change, produce at least:

```text
published programs affected
organization count affected
automations affected
UI placements affected
blocked vs migration-required count
```

Early phases may warn rather than fail deploys, but mature production should fail for known blocked Lumière-managed programs unless an approved migration/exception exists.

---

## 10. Migration model

Migration creates a **new** WorkProgram version.

```text
v3 published
   ↓
contract change
   ↓
migration draft
   ↓
update refs/code/schema
   ↓
re-run certification
   ↓
publish v4
```

Never mutate v3 in place.

For organization programs, support:

```text
manual migration
AI-assisted migration proposal
Lumière-provided deterministic migration recipe
```

AI-assisted migration may propose edits but publication still goes through normal certification/admin review.

---

## 11. Deprecation and retirement

A program may be:

```text
deprecated
  remains runnable for a bounded period

blocked
  cannot execute safely/compatibly

retired
  hidden from new use; historical runs remain inspectable
```

UI placements and automations referencing blocked/retired versions should display explicit state rather than silently disappearing.

Automations should pause automatically when their pinned version is blocked.

---

## 12. Promotion toward deterministic/native capabilities

Track privacy-safe operational signals:

```text
reuse count
success rate
correction rate
runtime cost
model-call count
sandbox iterations
organization adoption count
common input/output pattern
common capability composition
```

Candidate promotion criteria:

```text
frequent
stable
low correction
high cost or latency when left probabilistic
broadly reusable
clear deterministic contract
```

Progression:

```text
ad-hoc work
→ CodeArtifact
→ WorkProgram
→ organization-approved tool
→ widely reused/certified program
→ native generated/handwritten capability where justified
```

Promotion is product engineering work, not automatic code generation into STDB.

---

## 13. UI requirements

Admin/program UI should expose:

```text
certification state
last certification date
failed checks
compatibility status
current contract target
version history/diff
deprecation warnings
affected automations
migration action
```

Do not make users interpret raw hashes/IR details unless they open an advanced diagnostics view.

---

## 14. CI and release integration

Add machine-readable checks for:

```text
program manifest validity
capability refs resolve
schema refs resolve
runtime refs resolve
no blocked dependency in published Lumière-managed program
compatibility report generated for contract changes
certification fixture suite status
```

For repository-owned built-in programs, CI should run certification fixtures directly.

For tenant-authored programs, deployment tooling should at minimum run compatibility analysis against the target contract version and queue required retests/migrations.

---

## 15. Implementation phases

### WPC-0 — manifests and dependency graph

- [ ] define immutable version manifest;
- [ ] register capability/code/runtime/presentation dependencies;
- [ ] build reverse dependency queries;
- [ ] surface affected automation/UI placement queries.

### WPC-1 — certification engine

- [ ] define certification levels/report schema;
- [ ] implement static validation + fixture runner integration;
- [ ] integrate performance/security checks from their owning plans;
- [ ] support organization approval publishing flow.

### WPC-2 — contract compatibility analysis

- [ ] diff application-contract versions structurally;
- [ ] classify affected WorkPrograms;
- [ ] generate `ProgramCompatibilityReport`;
- [ ] surface blocked/migration-required programs before deployment.

### WPC-3 — migration/deprecation workflow

- [ ] fork incompatible version into migration draft;
- [ ] support manual/AI-assisted migration proposal;
- [ ] rerun certification;
- [ ] pause automations for blocked versions;
- [ ] expose UI warnings/version transitions.

### WPC-4 — promotion analytics

- [ ] collect privacy-safe reuse/success/cost metrics;
- [ ] rank native-capability candidates;
- [ ] require human/product review before promotion.

---

## 16. Acceptance criteria

This plan is successful when:

- every published WorkProgram has an immutable dependency manifest;
- application-contract changes can identify affected programs before users discover breakage;
- incompatible versions fail closed;
- organization admins can understand and migrate/deprecate programs without editing raw runtime state;
- automations remain pinned to exact versions and pause on blocked compatibility;
- certification burden scales with program risk;
- widely reused WorkPrograms provide evidence for future native ERP capability investment without automatically generating authoritative code.
