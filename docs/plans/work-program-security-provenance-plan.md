# WorkProgram security, provenance, and supply-chain plan

**Status:** Proposed — 2026-08-24  
**Tracks:** `work-program`, `security`, `provenance`, `supply-chain`, `credentials`, `untrusted-content`, `sandbox`, `attestation`, `sbom`, `artifact-integrity`  
**Related:** [work-program-runtime-execution-plan.md](./work-program-runtime-execution-plan.md) · [work-program-certification-compatibility-plan.md](./work-program-certification-compatibility-plan.md) · [agent-sandbox-data-analysis-plan.md](./agent-sandbox-data-analysis-plan.md) · [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-performance-admission-cost-plan.md](./agent-performance-admission-cost-plan.md)

---

## 1. Objective

Treat reusable WorkPrograms and CodeArtifacts as software-like executable assets with explicit provenance, dependency integrity, trust boundaries, and credential isolation.

Once a Python program, report recipe, OCR workflow, import transformation, or composed business process can be saved and reused organization-wide, it must not be treated as an opaque chat artifact.

Target trust model:

```text
WorkProgramVersion
  ├── immutable graph hash
  ├── CodeArtifact hashes
  ├── dependency locks / SBOM
  ├── runtime profile refs
  ├── capability refs
  ├── provenance / author / source task
  └── certification refs
        ↓
pre-execution verification
        ↓
scoped sandbox / provider adapters
        ↓
short-lived grants only
        ↓
evidence + artifacts + audit
```

---

## 2. Non-negotiable invariants

1. Reusable executable artifacts are immutable once published.
2. Every executable artifact has a content hash and provenance record.
3. Sandbox code receives no standing ERP/database/object-store/provider credentials.
4. External credentials are brokered through scoped short-lived capability grants where possible.
5. Untrusted user/external/document content is data, never runtime policy or instructions.
6. Provider/model/OCR/research outputs do not gain authority merely because a WorkProgram references them.
7. Consequential ERP actions always return to generated capability/Casbin/STDB paths.
8. Runtime dependency installation from arbitrary internet sources is forbidden for published profiles.
9. Revoked or vulnerable artifacts/runtime profiles can be blocked centrally.
10. Evidence/provenance must survive sandbox destruction.

---

## 3. Trust classes for inputs and outputs

Define explicit trust labels:

```ts
type ContentTrustClass =
  | "authoritative-erp"
  | "trusted-system-metadata"
  | "user-supplied"
  | "external-research"
  | "document-extracted"
  | "model-generated"
  | "derived-evidence"
  | "published-artifact"
```

The runtime should preserve trust labels through transformations.

Examples:

```text
STDB invoice rows
→ authoritative-erp

uploaded supplier contract
→ user-supplied

OCR text from that contract
→ document-extracted

web commodity price
→ external-research

Python aggregate over authorized data
→ derived-evidence
```

No trust-class transition should silently imply authorization.

---

## 4. Prompt-injection / untrusted-content boundary

The runtime must structurally separate:

```text
instructions / program definition
from
untrusted data
```

External pages, uploaded spreadsheets, PDFs, OCR text, emails, and model-generated content must never be able to:

- redefine allowed capabilities;
- add runtime permissions;
- change organization/company scope;
- alter approval policy;
- select hidden credentials;
- install packages;
- bypass evidence limits;
- instruct the harness to ignore system/runtime rules.

For model steps, untrusted content must be passed as labelled data fields rather than concatenated into privileged instruction text where avoidable.

Add policy checks for suspicious instruction-like content in high-risk document/research workflows, but do not rely on prompt filtering alone.

---

## 5. CodeArtifact manifest

```ts
interface CodeArtifactManifest {
  id: CodeArtifactId
  version: number
  contentHash: string
  language: "python" | "wasm" | "other-approved"
  runtimeProfile: RuntimeProfileRef
  entrypoint: string
  dependencyLock?: ArtifactRef
  sbom?: ArtifactRef
  sourceTask?: AgentTaskId
  author: ActorRef
  organizationScope?: OrganizationId
  createdAt: string
  status: "draft" | "tested" | "published" | "revoked"
}
```

Published WorkPrograms reference exact CodeArtifact versions/hashes, never mutable file paths.

---

## 6. Dependency and runtime supply-chain policy

Published runtime profiles should be prebuilt and versioned.

```text
approved base image
  + pinned Python version
  + pinned Lumière SDK
  + approved package set
  + dependency lock
  + vulnerability scan
  + image digest
```

Rules:

- no arbitrary `pip install` from model-written code in published execution;
- no floating `latest` dependencies;
- no unsigned/untracked custom package source;
- runtime images reference immutable OCI digests where practical;
- dependency lock/SBOM is retained with the artifact/version;
- high-severity vulnerability policy can block new execution pending review.

Exploratory sandbox sessions may support a broader approved experimentation profile, but promotion to reusable WorkProgram must pin the environment.

---

## 7. Artifact provenance

Every durable output should answer:

```text
who initiated this?
which WorkProgramVersion produced it?
which CodeArtifact version/hash ran?
which runtime profile/image ran?
which authorized datasets/watermarks were used?
which research/document/OCR sources contributed?
which model/provider/version produced probabilistic output?
which approvals/capability calls followed?
```

Conceptual record:

```ts
interface ArtifactProvenance {
  artifact: ArtifactRef
  runId: ProgramRunId
  programVersion: WorkProgramVersionRef
  codeArtifacts: readonly CodeArtifactVersionRef[]
  runtimeProfiles: readonly RuntimeProfileRef[]
  datasetWatermarks: readonly DatasetWatermarkRef[]
  evidenceRefs: readonly EvidenceRef[]
  externalSourceRefs: readonly ExternalSourceRef[]
  modelExecutionRefs: readonly ModelExecutionRef[]
  correlationId: CorrelationId
}
```

Do not persist hidden chain-of-thought as provenance.

---

## 8. Execution attestation

For published/certified runs, produce an execution attestation sufficient to reproduce the environment and prove which immutable inputs/code were selected.

```ts
interface ProgramExecutionAttestation {
  runId: ProgramRunId
  graphHash: string
  codeHashes: readonly string[]
  runtimeImageDigests: readonly string[]
  policyVersion: string
  certificationRef?: CertificationReportRef
  startedAt: string
  completedAt?: string
}
```

Initial phases may store ordinary signed/hash-linked metadata rather than introduce a complex external attestation framework.

The important property is tamper-evident linkage between run, program version, code, runtime, and artifacts.

---

## 9. Credential broker

Do not expose long-lived external credentials to model context or generic sandbox environment variables.

Target flow:

```text
WorkProgram step
    ↓
external CapabilityKey
    ↓
server-side authorization
    ↓
CredentialBroker
    ↓
scoped short-lived grant / provider call
    ↓
normalized bounded result
```

The program should express intent such as:

```text
research.commodity_prices
storage.read_uploaded_document
supplier.lookup
bank.statement.fetch
```

not raw provider API keys.

Suggested broker contract:

```rust
trait CredentialBroker {
    async fn issue_grant(
        &self,
        context: &TrustedExecutionContext,
        capability: &ExternalCapabilityKey,
        scope: &ExternalScope,
    ) -> Result<ShortLivedGrant, CredentialError>;
}
```

Where a provider cannot support scoped temporary credentials, keep the credential server-side and proxy the operation rather than copying it into the sandbox.

---

## 10. Sandbox policy

Default published sandbox posture:

```text
network: off
filesystem: sandbox-local scratch + approved mounted workspace
credentials: none
ERP access: Lumière SDK / task-scoped dataset handles only
object storage: brokered scoped access only
package install: disabled
process/runtime: bounded
CPU/RAM/disk/time: bounded
```

Research/document profiles may have controlled brokered capabilities, not unrestricted egress.

A sandbox must never reach STDB/Postgres using raw connection credentials.

---

## 11. External research/document/OCR provenance

External information used in material reports must retain:

```text
source URI/provider ref
retrieved_at
content hash where practical
trust class
extracted fields / evidence refs
freshness requirement
```

OCR/document workflows should retain:

```text
source file hash
page/range refs when available
OCR provider/version
extraction confidence
human correction refs
```

A model-generated summary is not a substitute for source provenance.

Implement the shared [harness evidence and intellectual provenance contract](./ai-harness-completion-plan.md#7-evidence-intellectual-provenance-and-knowledge-contract)
and M1–M5 gates. `ExternalSourceRef` must resolve to a versioned source and exact
passage; preserve original author/organization and edition separately from the
user/agent contribution that introduced it. Unknown metadata remains unknown.
Artifact provenance must additionally resolve claims, decisions/adaptations and
versioned component bindings, including parent links after edits or forks.

Source origin, verification outcome, domain approval and applicability are
independent dimensions. Neither derived output nor approved publication silently
upgrades the truth of its premises. Required source changes/retractions and
permission revocations invalidate dependent knowledge/artifact reuse and caches;
historical inspection remains scoped and subject to retention/tombstones.
Completeness of a manifest alone does not satisfy claim support or domain review.

The [interactive harness contract](./ai-harness-completion-plan.md#8-interactive-execution-and-recovery)
also binds questions, steering, diagnostics and compaction to versioned decisions
and candidates. Replies/mode changes cannot grant authority; fork/resume cannot
replay business effects or restore old grants. Specialist tasks share bounded
parent reservations and capability subsets. Lifecycle extensions require M9
admission with pinned versions/order, timeouts, idempotency and failure policy;
optional failures degrade visibly and required checks fail closed. Reauthorize
transformed calls and prohibit hooks from rewriting trusted actor context.

---

## 12. Revocation and emergency blocking

Support central revocation for:

```text
CodeArtifact version
RuntimeProfile version
WorkProgramVersion
provider adapter
external capability
certificate/certification status
```

Revocation should affect **new executions** immediately according to policy.

Existing historical artifacts/runs remain inspectable with their original provenance.

Automations referencing revoked dependencies should pause and surface an explicit error state.

---

## 13. Organization boundaries and sharing

Artifacts/programs may have scopes such as:

```text
personal
team
organization
system/Lumière
```

Rules:

- organization-scoped artifacts cannot be referenced across organizations unless explicitly promoted to system/Lumière scope through reviewed publication;
- cloning/forking across allowed scopes creates a new artifact/version/provenance root;
- no shared CodeArtifact may contain organization data or embedded secrets;
- reusable templates may be shared, but data bindings are always reacquired under current tenant authorization.

---

## 14. Security review by effect class

Scale review with effect:

### Read/report programs

Primary risks:

```text
data disclosure
prompt injection
malicious/unsafe dependencies
external-source poisoning
```

### Import/document programs

Add:

```text
malformed files
resource exhaustion
entity mapping corruption
large-output amplification
```

### Consequential programs

Add:

```text
incorrect draft/action generation
approval bypass attempts
replay/idempotency failure
bulk blast radius
```

The certification plan should consume these security classifications rather than duplicate them.

---

## 15. Logging and privacy

Security telemetry should capture:

```text
artifact/program hashes
capability names
policy decisions
provider/runtime versions
scope refs
failure categories
credential-grant metadata
```

Avoid logging:

```text
raw secrets
full raw datasets
unbounded document contents
hidden model reasoning
```

Sensitive artifact content should remain in the existing authorized artifact/file system with scoped references.

---

## 16. CI and admission checks

Fail or block publication/execution for:

```text
missing content hash
unresolved/revoked CodeArtifact
unapproved runtime profile
floating/unlocked dependency set
forbidden package/runtime behavior
missing provenance manifest
untrusted content promoted to policy/instruction field
raw DB credential requirement
unrestricted network requirement without explicit reviewed exception
```

Warn/review for:

```text
broad external network capability
high-risk document parsing
large artifact/output bounds
new package dependency
new external credential scope
```

---

## 17. Implementation phases

### WPS-0 — trust/provenance model

- [ ] define trust classes;
- [ ] define CodeArtifact manifest + content hashes;
- [ ] persist ArtifactProvenance;
- [ ] attach provenance to ProgramRun outputs/evidence.

### WPS-1 — pinned runtime/dependencies

- [ ] version runtime profiles by immutable image digest;
- [ ] store dependency locks/SBOM for published CodeArtifacts;
- [ ] disable arbitrary package installation in published profiles;
- [ ] add vulnerability/revocation status.

### WPS-2 — credential broker

- [ ] define external capability/credential scope model;
- [ ] implement short-lived grant or server-side proxy pattern;
- [ ] prove no model/sandbox receives standing provider secrets;
- [ ] audit grant issuance/revocation.

### WPS-3 — untrusted-content isolation

- [ ] label document/web/upload content by trust class;
- [ ] separate data from privileged instructions in model-step context compiler;
- [ ] add injection-resistance eval fixtures;
- [ ] ensure external content cannot mutate program graph/policy/capabilities.

### WPS-4 — execution attestation/revocation

- [ ] generate run attestation linked to graph/code/runtime hashes;
- [ ] implement central artifact/runtime/program revocation;
- [ ] pause affected automations;
- [ ] expose admin diagnostics.

### WPS-5 — security certification integration

- [ ] feed security results into `CertificationReport`;
- [ ] scale required checks by program effect/risk class;
- [ ] add CI/admission gates for repository-owned built-in programs.

---

## 18. Acceptance criteria

This plan is successful when:

- every published reusable executable is hash-addressed and versioned;
- runtime/dependency sets are pinned and inspectable;
- model/sandbox execution requires no standing ERP/provider secrets;
- external/document content remains explicitly untrusted and cannot redefine authority;
- artifacts retain enough provenance to trace their program/code/runtime/data/source lineage;
- revoked/vulnerable dependencies can be blocked centrally;
- automations fail closed when a required dependency is revoked;
- security checks feed the normal certification/publication flow rather than forming a parallel approval system.
