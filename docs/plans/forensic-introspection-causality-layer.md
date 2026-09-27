# Forensic Introspection & Causality Layer

**Status:** Proposed — architecture / implementation plan  
**Stack position:** `INT-PLAN → ADV-PLAN → HSEC-PLAN → HLEARN-PLAN → INTRO-PLAN`  
**Primary objective:** Give each organization a privacy-preserving, tamper-evident, queryable account of who accessed what, which operation ran, which policy decision applied, what downstream effects occurred, and how AI/workflow/tool activity caused later ERP state changes — without building a shadow copy of customer data.

---

## 1. Why this plan exists

Lumière already has several pieces of an introspection system:

- request correlation IDs and release IDs in the Rust API;
- Prometheus request/error counters;
- `tower_http::TraceLayer` request spans;
- authenticated user-session resolution;
- typed `/v1/operations/:operation` execution;
- `/v1/query/:resource` reads;
- `/v1/compat/reducer/:reducer` compatibility traffic;
- domain routers under `/v1/*`;
- append-only STDB `AuditLog` rows;
- generated application-operation identities;
- organization commit/reconstruction concepts;
- AI harness execution events, evidence/provenance, tool calls, decisions and run correlation;
- HSEC residency / retention / sandbox rules;
- HLEARN decision trace / replay / correction / comparison design.

What is missing is one coherent forensic layer that joins those facts together.

The original investigation proposal suggested logging every request/response body in raw form and anonymizing it afterwards. This plan intentionally does **not** adopt that as the default architecture.

Raw body capture would create a second, high-risk replica of ERP data, expand the data-retention surface, weaken data-minimization guarantees, complicate residency, and make the audit system itself one of the largest stores of sensitive customer data.

Instead, the default design is:

```text
request / query / operation / workflow / harness step
                     ↓
            trusted context resolution
                     ↓
          semantic introspection event
                     ↓
      bounded metadata + references + hashes
                     ↓
        optional encrypted evidence object
                     ↓
     searchable per-organization forensic index
```

The central rule is:

> Capture semantics by default. Capture payload evidence only when a reviewed audit policy requires it.

---

## 2. Current-state corrections to the original investigation

### 2.1 Canonical mutation endpoint

The current Rust router is not centered on `/v1/call/*` anymore.

Canonical current paths include:

```text
GET  /v1/query/:resource
GET  /v1/authoritative/:resource/:id
POST /v1/operations/:operation
POST /v1/compat/reducer/:reducer
GET  /v1/realtime/ws
GET  /v1/realtime/info
+ domain routers
```

`/v1/operations/:operation` is the preferred typed mutation seam.

`/v1/compat/reducer/:reducer` exists for compatibility and should be separately visible in introspection so production dependence on compatibility paths can be measured and driven downward.

### 2.2 Current HTTP observability

The API already generates:

```text
x-correlation-id
x-lumiere-release
operation_id spans for typed operations
request counters
5xx counters
typed-operation counters
compat-reducer counters
```

The introspection layer should extend this seam rather than introduce an unrelated reverse-proxy logging stack.

### 2.3 Existing audit log

STDB already has an append-only `AuditLog` and configurable `AuditRule`.

Current audit fields include:

```text
organization_id
company_id
table_name
record_id
action
old_values
new_values
changed_fields
user_identity
session_id
ip_address
user_agent
timestamp
metadata
```

That is useful for canonical business-change auditing, but it should not become the universal high-volume HTTP forensic store.

The plan separates:

```text
BusinessAuditEvent
```

from:

```text
OperationalIntrospectionEvent
```

and links them through correlation / causation / business commit lineage.

---

## 3. Non-negotiable invariants

1. **Organization scope is server-derived.** Admin APIs do not accept arbitrary `org_id` as an authorization mechanism.
2. **The audit system must not become a shadow ERP database.** Full payload capture is exceptional.
3. **Identity pseudonymization is organization-local.** The same actor does not receive a globally stable pseudonym across organizations.
4. **Pseudonym keys never leave trusted server-side key management.** Org admins do not receive salts/keys.
5. **Authorization for introspection is independent and current.** Historical admin status does not grant present access.
6. **Introspection of introspection is mandatory.** Sensitive audit searches and exports are themselves audited.
7. **Critical business effects are not lossy telemetry.** Consequential changes must retain durable audit lineage even if the async observability pipeline is unhealthy.
8. **Operational telemetry may degrade without blocking ordinary ERP where policy permits.** Business-critical audit lineage may not silently disappear.
9. **Sensitive evidence is encrypted and separately retained.** Search indexes contain bounded metadata and refs, not plaintext copies by default.
10. **Tampering must be detectable.** Durable event partitions carry sequence/hash integrity.
11. **Retention is explicit by data class.** No open-ended “keep logs forever” behavior.
12. **Residency follows the organization execution/storage policy.** Introspection is not exempt from HSEC placement constraints.
13. **AI/tool/workflow events use the same causal graph.** No parallel AI-only audit universe.
14. **Hidden chain-of-thought is never stored.** HLEARN stores structured observable decisions, sources, evidence, tools and outcomes only.
15. **Exports are policy-governed copies.** Export creation, download, expiry and deletion are traceable.

---

## 4. Event taxonomy

Do not put every concern into one generic JSON log row.

Use a shared envelope with typed event payloads.

Initial classes:

```text
AccessEvent
OperationEvent
BusinessAuditEvent
AuthorizationEvent
SecurityEvent
WorkflowEvent
AgentExecutionEvent
ProviderEvent
SandboxEvent
OfflineSyncEvent
ImportEvent
AdminIntrospectionEvent
ExportEvent
RetentionEvent
```

### 4.1 AccessEvent

Represents meaningful data access.

Examples:

```text
query resource
open authoritative record
download document
export report
open payroll record
read sensitive evidence
```

Capture metadata such as:

```text
resource key
query class
bounded filters/fingerprint
field classification set
row count
result bytes
export/download flag
```

Do not default to storing returned rows.

### 4.2 OperationEvent

Represents invocation of a typed application operation.

Examples:

```text
erp.confirm_sales_order
erp.post_invoice
erp.validate_stock_picking
erp.approve_expense_sheet
```

Capture:

```text
operation id
operation version/schema hash
input shape fingerprint
resource refs
risk/effect class
outcome
latency
retry/idempotency metadata
```

### 4.3 BusinessAuditEvent

Represents canonical business state effects.

Examples:

```text
sales order state changed
payment posted
inventory quantity changed
permission changed
approval recorded
```

This class should remain closely tied to STDB state transitions and organization commit lineage.

### 4.4 AuthorizationEvent

Represents policy decisions worth forensic retention.

Examples:

```text
allowed
denied
approval required
scope narrowed
company membership missing
permission revoked mid-run
```

Avoid logging raw policy secrets or internal implementation detail unnecessarily.

### 4.5 AgentExecutionEvent

Reuses the HLEARN/HSEC event model.

Examples:

```text
capability selected
capability requested
capability authorized
dataset acquired
source fetched
decision recorded
sandbox started
evidence emitted
action draft proposed
human correction added
run forked
```

### 4.6 AdminIntrospectionEvent

Every sensitive introspection operation emits this event.

Examples:

```text
admin queried employee activity
admin resolved pseudonym to named actor
admin opened encrypted evidence
admin generated export
admin changed retention rule
```

---

## 5. Shared event envelope

Conceptual Rust model:

```rust
pub struct IntrospectionEventEnvelope<T> {
    pub event_id: EventId,
    pub schema_version: u32,

    pub organization_id: OrganizationId,
    pub company_scope: Vec<CompanyId>,

    pub occurred_at: Timestamp,
    pub observed_at: Timestamp,

    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub parent_event_id: Option<EventId>,

    pub actor_pseudonym: ActorPseudonym,
    pub actor_type: ActorType,

    pub source: InvocationSource,

    pub operation_id: Option<OperationId>,
    pub resource_key: Option<ResourceKey>,

    pub outcome: EventOutcome,
    pub effect_class: EffectClass,

    pub release_id: ReleaseId,
    pub contract_schema_hash: Option<SchemaHash>,
    pub placement_generation: PlacementGeneration,

    pub integrity: EventIntegrity,
    pub payload: T,
}
```

### 5.1 InvocationSource

Suggested values:

```text
browser
public-api
server-job
projection-worker
integration-worker
workflow
ai-harness
sandbox
provider-callback
offline-sync
import
admin-console
```

### 5.2 EventOutcome

```text
success
denied
validation-error
conflict
stale
retryable-failure
permanent-failure
outcome-unknown
cancelled
```

### 5.3 EffectClass

```text
read-only
configuration
business-write
financial
inventory
permission
approval
external-dispatch
privacy-sensitive
security-sensitive
```

---

## 6. Correlation and causality

The existing HTTP correlation ID becomes the root for ordinary request chains.

Target causal graph:

```text
HTTP Request
  ↓ correlation
AuthorizationEvent
  ↓ causation
OperationEvent
  ↓ causation
BusinessAuditEvent
  ↓ causation
Projection / integration / provider event
```

Harness example:

```text
User request
  ↓
AgentRun
  ↓
CapabilityRequested
  ↓
AuthorizationEvent
  ↓
AccessEvent
  ↓
DatasetAcquired
  ↓
DecisionRecord
  ↓
ActionDraft
  ↓
HumanApproval
  ↓
OperationEvent
  ↓
BusinessAuditEvent
```

Admin UI must be able to pivot from any node to:

```text
what caused this?
what did this cause?
what actor initiated it?
which policy authorized it?
which release/contract executed it?
which downstream records resulted?
```

---

## 7. Identity pseudonymization

### 7.1 Do not use decryptable salted hashes

A salted hash is not reversible.

Do not design the system around:

```text
SHA256(user_id + org_salt)
```

with the expectation that an admin can “decrypt” it.

### 7.2 Use keyed HMAC pseudonyms

Preferred construction:

```text
actor_pseudonym = HMAC-SHA256(
  org_pseudonym_key,
  canonical_actor_id
)
```

Properties:

- deterministic within one organization;
- not globally correlatable;
- not enumerable without the key;
- key can rotate/version;
- admins never need to receive the key.

### 7.3 Identity resolution

Authorized forward lookup:

```text
named user
  ↓
server resolves canonical actor ID
  ↓
server computes org pseudonym
  ↓
query forensic store
```

Authorized reverse investigation:

```text
actor pseudonym
  ↓
privileged server-side identity-resolution service
  ↓
current Casbin check
  ↓
named actor
  ↓
AdminIntrospectionEvent emitted
```

### 7.4 Pseudonym key rotation

Store:

```text
key version
valid-from
retired-at
organization binding
```

Events carry pseudonym-key version metadata sufficient for server-side authorized resolution.

Do not rewrite historical events on key rotation.

---

## 8. Field classification and IR-driven capture policy

Do not maintain a giant hand-written list of keys like `email`, `password`, `token`.

Extend application-contract IR metadata with introspection classification.

Conceptual model:

```ts
interface FieldIntrospectionPolicy {
  classification:
    | "public"
    | "business"
    | "personal"
    | "sensitive-personal"
    | "financial"
    | "credential"
    | "secret"

  audit:
    | "omit"
    | "presence"
    | "hash"
    | "bounded-value"
    | "resource-ref"
    | "encrypted-evidence"
}
```

Examples:

```text
organization_id     → trusted scope metadata
company_id          → trusted scope metadata
sale_order_id       → resource-ref
amount_total        → bounded-value if policy permits
customer_email      → hash/omit
free-form notes     → omit by default
password            → never
JWT                 → never
provider token      → never
raw document body   → evidence ref only
```

Generated capture descriptors should accompany operation/query descriptors.

---

## 9. Capture policy by operation type

### 9.1 Reads

Capture semantics:

```text
resource
scope
query class
filter fingerprint
field classifications
row count
result bytes
latency
export/download state
```

Do not retain returned rows by default.

### 9.2 Ordinary writes

Capture:

```text
operation
resource refs
input shape hash
changed-field classes
outcome
commit/ref linkage
```

### 9.3 High-risk writes

Examples:

```text
payment posting
payroll posting
permission change
large purchase approval
bank-account change
AI consequential approval
retention/legal-hold change
```

May attach a separately encrypted `AuditEvidence` snapshot where policy requires exact historical proof.

### 9.4 Authentication / session traffic

Never capture credentials/tokens.

Capture only bounded facts such as:

```text
sign-in success/failure
pseudonym where resolved
session class
client class
risk signals
network pseudonym/prefix
```

---

## 10. Sensitive evidence tier

Introduce a separate concept:

```ts
interface AuditEvidenceManifest {
  id: AuditEvidenceId
  organizationId: OrganizationId
  eventId: EventId
  classification: DataClassification
  contentHash: string
  encryptionKeyRef: KeyRef
  storageRef: ObjectRef
  createdAt: string
  expiresAt?: string
  legalHoldRef?: LegalHoldRef
}
```

Rules:

- encrypted at rest;
- organization-scoped encryption/key policy;
- region constrained by HSEC;
- no public URL;
- short-lived signed/brokered access only;
- evidence reads audited;
- evidence retention independent from metadata retention;
- deletion/legal hold tested through HSEC canaries.

Examples of evidence that may justify exact snapshots:

```text
approved payment instructions
before/after privileged policy change
signed document version
human-approved AI action payload
high-value purchase approval payload
```

---

## 11. Existing STDB AuditLog evolution

Do not immediately remove current `AuditLog`.

Near-term role:

```text
canonical business mutation evidence
```

Long-term improvements:

- replace free-form old/new JSON where possible with typed refs/diffs;
- remove or restrict plaintext IP/user-agent storage;
- add correlation ID;
- add operation ID;
- add organization commit sequence / business commit ref;
- add release/schema metadata;
- use evidence refs instead of large sensitive blobs;
- ensure tenant ownership/projection/reconstruction semantics are explicit.

Potential long-term split:

```text
BusinessAuditDescriptor   — STDB / same business authority
IntrospectionEvent        — durable query/index pipeline
AuditEvidence             — encrypted object storage
```

---

## 12. Durability model

### 12.1 Telemetry vs audit

Do not treat them equally.

```text
HTTP timing metric
```

may be lossy.

```text
payment posted by actor X under approval Y
```

may not silently disappear.

### 12.2 Consequential business effects

Target:

```text
STDB business transaction
     ↓ same canonical transition
BusinessAuditDescriptor
     ↓ durable commit/projection sequence
Introspection projection
```

Avoid:

```text
business commit
  ↓
fire-and-forget async logger
  ↓ logger unavailable
  ↓ audit lost
```

### 12.3 Operational HTTP/access events

May flow asynchronously through a bounded non-blocking sink where policy allows.

If the sink is unavailable:

- ordinary read traffic may continue;
- counters surface degraded introspection;
- no unbounded in-memory queue;
- consequential audit lineage still uses durable business path.

---

## 13. Storage architecture

Initial Lumière-native target:

```text
API / STDB / AI Gateway
        ↓
semantic event producers
        ↓
DurableIntrospectionSink
        ↓
Scaleway Managed PostgreSQL
        ├── partitioned event metadata
        ├── actor/resource/operation indexes
        ├── correlation/causation indexes
        ├── export manifests
        ├── admin query audit
        └── retention metadata

Sensitive evidence / large immutable manifests
        ↓
Scaleway Object Storage
        └── encrypted hash-addressed objects
```

Do not require Kafka for v1.

Define a sink seam:

```rust
#[async_trait]
pub trait IntrospectionSink {
    async fn append(
        &self,
        event: IntrospectionEventEnvelope,
    ) -> Result<(), IntrospectionError>;
}
```

Possible future sinks:

```text
PostgresIntrospectionSink
StreamingIntrospectionSink
WarehouseIntrospectionSink
CustomerWebhookSink
```

but provider choice must not alter semantics.

---

## 14. PostgreSQL forensic index

Suggested partitioning:

```text
organization_id
+ occurred_at time range
```

Core index dimensions:

```text
organization_id
occurred_at
actor_pseudonym
operation_id
resource_key
resource_ref
correlation_id
effect_class
outcome
source
```

Avoid indexing sensitive arbitrary JSON.

Store bounded structured columns first; small typed JSON payloads are acceptable for event-specific metadata when schema/versioned.

---

## 15. Tamper evidence

“No UPDATE reducer” alone is not strong enough forensic integrity.

Use per-organization/partition sequencing and hash linkage.

Conceptual:

```rust
pub struct EventIntegrity {
    pub sequence: u64,
    pub previous_hash: Option<Hash>,
    pub event_hash: Hash,
}
```

Computation:

```text
hash_n = H(
  canonical_event_n
  || previous_hash
  || organization_id
  || sequence
)
```

Periodically persist an integrity checkpoint outside the primary table, for example in a separately protected object/manifest.

Prefer alignment with existing monotonic organization commit sequencing where the event originates from canonical ERP state.

---

## 16. Network/IP privacy

Do not blindly keep plaintext full IP addresses.

Suggested normalized network evidence:

```text
ip_hmac              — stable org-local same-IP correlation
network_prefix        — optionally coarsened
country/region        — derived at trusted ingress if justified
trusted_proxy_class   — Cloudflare/Kong/direct
risk flags            — bounded
```

Exact IP retention, if required for security/legal reasons, belongs in restricted encrypted evidence with shorter policy-driven retention.

User agent should be normalized where possible into bounded client metadata:

```text
browser family
OS family
app/client version
device class
```

rather than indefinite raw UA strings.

---

## 17. Introspection API

Do **not** authorize with:

```http
GET /v1/introspect?org_id=123
```

The organization is resolved from trusted session/context.

Proposed API family:

```http
GET  /v1/introspection/events
GET  /v1/introspection/events/{event_id}
GET  /v1/introspection/correlations/{correlation_id}
GET  /v1/introspection/actors/{actor_pseudonym}/summary
GET  /v1/introspection/resources/{resource_key}/{resource_id}/timeline
POST /v1/introspection/identity/resolve
POST /v1/introspection/exports
GET  /v1/introspection/exports/{export_id}
DELETE /v1/introspection/exports/{export_id}
```

Filter dimensions:

```text
time range
actor pseudonym
company
operation
resource
record ref
event class
outcome
effect class
source
correlation ID
release ID
```

### 17.1 Pagination

Use cursor pagination ordered by:

```text
occurred_at DESC, event_id DESC
```

Do not permit unbounded result sets.

### 17.2 Aggregation endpoints

Provide bounded server-side analytics such as:

```text
request count by operation
error rate
p50/p95/p99 latency
denied operations by actor
top exported resources
compat reducer usage
sensitive data access count
AI action approval rate
```

Do not expose generic arbitrary SQL to org admins.

---

## 18. Introspection authorization model

Use explicit capabilities, for example:

```text
introspection.summary.read
introspection.events.read
introspection.identity.resolve
introspection.sensitive_evidence.read
introspection.export
introspection.retention.read
introspection.retention.manage
introspection.legal_hold.manage
introspection.integrity.verify
```

Suggested personas:

### Organization Admin

May inspect bounded operational metadata.

### Security / Privacy Admin

May resolve actor identity and access higher-sensitivity evidence according to policy.

### Auditor

May receive read-only scoped access to approved event classes/time ranges.

### Platform Operator

Must not automatically receive customer-level plaintext evidence merely because they operate infrastructure.

Every introspection capability remains tenant-scoped and current-policy checked.

---

## 19. Introspection of introspection

Every privileged forensic action produces `AdminIntrospectionEvent`.

Capture:

```text
admin actor pseudonym
query class
filter fingerprint
time range requested
sensitivity class
result count
identity resolution performed?
evidence opened?
export created?
reason/ticket ref if required
```

Sensitive evidence access should support policy requiring a reason string or investigation ticket/reference.

Do not log the sensitive evidence contents again while auditing its access.

---

## 20. Admin investigation UI

The initial UI should not be a giant raw-log table.

Provide several investigation modes.

### 20.1 Timeline

```text
09:41 user opened SO-1024
09:42 quotation sent
09:43 approval requested
09:45 manager approved
09:46 order confirmed
09:47 picking created
```

### 20.2 Correlation graph

```text
request
  → auth decision
  → operation
  → business mutation
  → workflow/provider/AI downstream effects
```

### 20.3 Actor activity

```text
actor pseudonym
operations
reads
exports
denials
sensitive-resource accesses
AI runs
```

### 20.4 Resource timeline

For a sales order, payment, employee, document, etc.:

```text
who viewed it?
who changed it?
which workflow/agent caused changes?
which approvals existed?
which export/download included it?
```

### 20.5 Sensitive identity reveal

Default views remain pseudonymous.

A privileged “resolve identity” action is explicit, current-policy checked and audited.

---

## 21. Export model

Exports are themselves governed data copies.

`IntrospectionExportManifest` should include:

```text
organization
creator
query/filter fingerprint
columns/data classifications
row/event count
format
created_at
expires_at
storage ref
content hash
legal hold status
```

Formats:

```text
CSV
JSONL
Parquet later if justified
```

Rules:

- no arbitrary raw payload inclusion;
- sensitive identity inclusion requires separate permission;
- encryption at rest;
- temporary brokered download URL;
- explicit TTL;
- export download audited;
- expiry/deletion tested;
- residency follows organization policy.

---

## 22. Retention model

Do not hardcode one global `90 days raw / 2 years processed` rule.

Define class-based policy:

```ts
interface IntrospectionRetentionPolicy {
  metadataRetentionDays: number
  sensitiveEvidenceRetentionDays: number
  securityEventRetentionDays: number
  businessAuditRetentionDays: number
  exportRetentionDays: number
  providerTraceRetentionDays: number
}
```

Policy resolution:

```text
system/legal bounds
∩ organization policy
∩ company/country pack requirements
∩ data classification
∩ legal hold
```

HSEC remains the authority for complete-copy inventory and deletion proof.

---

## 23. Legal hold

Legal hold must be object/event scoped, not a blanket excuse to retain everything.

Example:

```text
hold payment audit evidence for case X
```

should not imply:

```text
retain every unrelated sandbox log and export forever
```

Retention workers must fail closed for held objects.

Hold creation/release is itself audited and highly privileged.

---

## 24. HSEC convergence

INTRO must reuse HSEC primitives for:

```text
trusted execution envelope
organization placement
region constraints
processor constraints
data-copy inventory
retention manifest
deletion canaries
legal hold
provider fallback policy
```

Introspection storage is explicitly listed as a tenant-data copy location.

It must never become an HSEC exception.

---

## 25. HLEARN convergence

HLEARN produces structured, observable run data such as:

```text
decisions
tool usage
sources
evidence
claims
corrections
replays
comparisons
outcomes
```

INTRO makes those records navigable in the broader organization causality graph.

Example:

```text
ERP record changed
  ↓
OperationEvent
  ↓
ActionDraft approval
  ↓
Agent decision
  ↓
Evidence
  ↓
External source
  ↓
User correction / replay
```

Do not duplicate HLEARN content in HTTP logs. Store refs and causal links.

---

## 26. Workflow / approval convergence

Workflow events should record:

```text
workflow instance
version
human task
claim
approval/rejection
delegation
policy version
target business record
```

This lets investigators answer:

```text
why was this operation allowed?
which approval covered it?
was the approved payload the executed payload?
```

ADV stale-approval certification should use these same refs.

---

## 27. Offline convergence

Offline ChangeSets must emit causal metadata when reconnected.

Capture:

```text
client changeset id
originating device pseudonym
offline created_at
server received_at
base revision
review/approval result
conflict/stale outcome
resulting canonical operation refs
```

Do not treat client-generated logs as trusted authority.

Server canonical events remain the forensic source of truth.

---

## 28. Import/data-ops convergence

For imports, capture:

```text
import job id
source artifact hash
mapping template version
row count
validation counts
accepted/rejected rows
canonical operations emitted
rollback event if any
```

Avoid storing the entire CSV again in event metadata.

The source file remains an artifact with its own retention/access policy.

---

## 29. Provider/integration convergence

For external providers:

```text
provider class
account ref pseudonym
request intent
provider correlation/event id
status
latency
retry count
callback causation
```

Do not log API keys, OAuth tokens, webhook secrets or full provider payloads into the introspection metadata store.

Provider payload evidence is optional encrypted evidence subject to provider/data-class policy.

---

## 30. Performance requirements

The original 10,000 req/s target should be treated as a stress objective, not a reason to prematurely introduce distributed-streaming infrastructure.

### Request path

For ordinary access events:

- bounded in-process serialization;
- no synchronous object-store write;
- no large payload inspection;
- bounded queue/backpressure;
- no unbounded retry loop;
- minimal allocation.

### Consequential writes

Durable audit descriptor should align with the canonical transaction/commit path, not the HTTP async telemetry path.

### Introspection queries

Target indexed common queries:

```text
org + time
org + actor + time
org + operation + time
org + resource ref
org + correlation id
```

P95 < 500 ms is a useful target for bounded recent-window queries, not a guarantee for unrestricted multi-year forensic scans.

Large exports are asynchronous jobs.

---

## 31. Backpressure and failure behavior

Define explicit behavior when the operational event sink is unavailable.

```text
read-only request
  → request succeeds
  → event degradation counter increments

consequential business write
  → business audit descriptor still persists canonically
  → projection to forensic index catches up later
```

Never allow the observability queue to grow without bound and starve ERP traffic.

Expose readiness/diagnostics separately:

```text
introspection sink healthy?
projection lag
oldest unprojected event
hash-chain verification state
retention worker state
export worker state
```

---

## 32. Versioning

Every event carries:

```text
schema_version
release_id
operation_id
contract_schema_hash where applicable
```

Do not assume historical payloads can be interpreted using the latest runtime schema.

Event parsers support explicit version migrations/read adapters.

Evidence objects are immutable/hash-addressed.

---

## 33. Data deletion and subject-right interactions

Pseudonymized event metadata may still constitute personal data depending on context and applicable law/policy.

Do not equate hashing with anonymization.

The implementation must distinguish:

```text
anonymous data
pseudonymous personal data
identifiable personal data
sensitive personal data
```

Deletion/retention/legal obligations must be resolved through policy, not through the assumption that HMAC pseudonyms make data non-personal.

Where business/legal audit records must be retained, identity resolution and payload exposure can still be minimized.

---

## 34. Threat model

### 34.1 Curious org admin

Attempts to inspect more employee data than necessary.

Controls:

```text
separate permissions
pseudonymous default
identity-resolution auditing
sensitive evidence auditing
bounded exports
```

### 34.2 Compromised application user

Attempts cross-org introspection filters.

Controls:

```text
server-derived org scope
no org_id authorization parameter
Casbin
row-level org predicates
ADV/HSEC tenancy sweeper
```

### 34.3 Compromised logging code

Attempts to exfiltrate secrets through event payloads.

Controls:

```text
IR-driven capture descriptors
secret/credential = never
bounded schemas
CI checks
redaction tests
```

### 34.4 Platform operator

Attempts to access customer evidence outside support policy.

Controls:

```text
customer-scope authorization
separate evidence broker
access audit
support-access workflow where required
```

### 34.5 Event-store tampering

Controls:

```text
append-only policy
hash chain
integrity checkpoints
separate checkpoint storage
read-only auditor verification
```

---

## 35. Adversarial certification

INTRO must be certified under ADV/HSEC-style attacks.

### INTRO-A01 — cross-tenant query

Attempt actor from org A to request filters/IDs from org B.

Expected:

```text
no B events returned
no B identity resolution
attempt itself audited
```

### INTRO-A02 — pseudonym enumeration

Attempt to infer actor identity by hashing likely IDs externally.

Expected:

```text
HMAC key unavailable
no direct deterministic public hashing oracle
```

### INTRO-A03 — secret capture

Send operation payload containing JWT/password/provider token fields.

Expected:

```text
no secret in metadata
no secret in trace logs
no secret in evidence unless explicitly impossible-by-policy (normally never)
```

### INTRO-A04 — denied operation

Denied operation still records bounded attempt metadata without exposing forbidden resource contents.

### INTRO-A05 — admin search abuse

Sensitive identity resolution emits immutable AdminIntrospectionEvent.

### INTRO-A06 — event tampering

Modify/delete historical event in test storage.

Expected integrity verification failure.

### INTRO-A07 — sink outage

Operational sink unavailable during normal read traffic.

Expected ERP remains usable, degradation visible.

### INTRO-A08 — sink outage during payment post

Expected canonical business audit remains durable and later projects into forensic store.

### INTRO-A09 — retention deletion

Expired evidence disappears from all required stores/indexes while metadata follows policy.

### INTRO-A10 — legal hold

Held evidence survives retention worker and deletion attempt.

### INTRO-A11 — export expiry

Expired export inaccessible and storage object removed/tombstoned according to policy.

### INTRO-A12 — HLEARN causality

Agent-originated business mutation can be traced back through action draft, approval, decision and evidence refs without exposing hidden chain-of-thought.

---

## 36. Current-state investigation deliverables

Before implementation, produce a generated/current-state inventory covering:

### API surface

For every route:

```text
method
path
auth class
trusted context source
operation/resource identity
payload type
response type
current traces/metrics
data classification
```

### Existing logging

Inventory:

```text
tracing spans
Prometheus counters
STDB AuditLog callers
provider logs
AI gateway execution events
projection logs
worker logs
frontend PostHog events
```

### Data stores

Document:

```text
STDB
Postgres cold tier
object storage
search/vector index
AI run/event state
browser/local storage
offline SQLite target
external processors
```

### Current sensitive logging risks

Search for:

```text
request body logging
response body logging
Authorization headers
cookies
raw email/phone/IP
provider payload dumps
raw SQL logging
sandbox stdout persistence
```

---

## 37. OpenAPI / contract direction

Do not hand-maintain a completely separate introspection API specification if the normal API contract generation can own it.

Introspection operations should be named stable operations, for example:

```text
introspection.events.list
introspection.event.read
introspection.correlation.read
introspection.actor.summary
introspection.identity.resolve
introspection.export.create
introspection.export.delete
```

Generated client/query hooks should consume those operations like the rest of the application.

---

## 38. UI integration

Initial route suggestion:

```text
/settings/security/introspection
```

or a dedicated admin module if the surface grows.

Primary views:

```text
Overview
Events
Correlations
Actors
Resources
Exports
Retention
Integrity
```

Security/privacy-sensitive UI should never render plaintext evidence in list previews by default.

---

## 39. Implementation stack

### INTRO-00 — current-state inventory + event taxonomy

- [ ] inventory routes and domain endpoints;
- [ ] inventory existing traces/metrics/audit writes;
- [ ] inventory data-copy locations;
- [ ] identify sensitive logging risks;
- [ ] define initial event classes;
- [ ] map current AuditLog to future BusinessAuditEvent role.

### INTRO-01 — shared event envelope + causality

- [ ] define `IntrospectionEventEnvelope`;
- [ ] correlation / causation / parent refs;
- [ ] release/schema metadata;
- [ ] actor/source/effect/outcome enums;
- [ ] stable canonical serialization for integrity hashing.

### INTRO-02 — IR-driven classification/capture policy

- [ ] add field classification metadata;
- [ ] add per-field audit mode;
- [ ] generate operation/query capture descriptors;
- [ ] CI check that secret/credential fields cannot be captured;
- [ ] fixture coverage for representative domains.

### INTRO-03 — actor pseudonymization + org keys

- [ ] HMAC pseudonym service;
- [ ] per-org key refs/versioning;
- [ ] forward actor→pseudonym lookup;
- [ ] privileged pseudonym→identity resolution;
- [ ] identity resolution auditing;
- [ ] rotation tests.

### INTRO-04 — HTTP/query/operation capture

- [ ] extend current Rust middleware/span seam;
- [ ] capture typed operation metadata;
- [ ] capture query metadata;
- [ ] distinguish compat reducer traffic;
- [ ] preserve request latency/error counters;
- [ ] no raw body logging by default.

### INTRO-05 — canonical business-audit projection

- [ ] add correlation/operation/commit refs to canonical audit descriptors;
- [ ] ensure consequential business effects cannot lose audit lineage;
- [ ] project STDB business audit into durable forensic index;
- [ ] reconstruction/replay proof.

### INTRO-06 — Postgres forensic index

- [ ] schema/versioned event tables;
- [ ] partitioning;
- [ ] indexes;
- [ ] cursor pagination;
- [ ] projection lag diagnostics;
- [ ] bounded aggregation queries.

### INTRO-07 — sensitive evidence/object tier

- [ ] `AuditEvidenceManifest`;
- [ ] encrypted object storage;
- [ ] brokered reads;
- [ ] content hashes;
- [ ] evidence access events;
- [ ] HSEC residency/retention integration.

### INTRO-08 — admin query API + Casbin

- [ ] capability keys;
- [ ] trusted-org scoping;
- [ ] events list/read;
- [ ] correlation graph data;
- [ ] actor summary;
- [ ] resource timeline;
- [ ] identity resolution;
- [ ] denial/tenancy tests.

### INTRO-09 — investigation UI

- [ ] timeline;
- [ ] correlation graph;
- [ ] actor activity;
- [ ] resource activity;
- [ ] sensitive evidence reveal flow;
- [ ] identity reveal flow;
- [ ] permission-aware UI.

### INTRO-10 — exports + introspection-of-introspection

- [ ] export jobs;
- [ ] bounded CSV/JSONL;
- [ ] export manifests;
- [ ] TTL/deletion;
- [ ] download audit;
- [ ] AdminIntrospectionEvent for sensitive queries;
- [ ] export abuse tests.

### INTRO-11 — retention / deletion / legal hold

- [ ] class-based retention policy;
- [ ] retention worker;
- [ ] evidence expiry;
- [ ] export expiry;
- [ ] legal hold;
- [ ] HSEC deletion canaries;
- [ ] policy diagnostics.

### INTRO-12 — integrity chain + verification

- [ ] per-org/partition sequence;
- [ ] previous/event hashes;
- [ ] checkpoint storage;
- [ ] verification command/API;
- [ ] corruption tests;
- [ ] auditor view.

### INTRO-13 — HLEARN/HSEC/harness convergence

- [ ] agent events participate in causality graph;
- [ ] action draft→approval→ERP mutation linking;
- [ ] source/evidence refs;
- [ ] replay/correction refs;
- [ ] sandbox/provider residency refs;
- [ ] no hidden reasoning retention.

### INTRO-14 — offline/import/integration convergence

- [ ] ChangeSet causality;
- [ ] import-job lineage;
- [ ] provider callback lineage;
- [ ] integration worker lineage;
- [ ] consistent pseudonym/scope handling.

---

## 40. Promotion gates

### Gate A — metadata-only pilot

Required:

- event envelope;
- pseudonymization;
- server-derived tenant scope;
- typed operation/query capture;
- no secret leakage;
- basic Postgres index;
- introspection admin permission;
- introspection-of-introspection.

### Gate B — business-audit certification

Required:

- consequential audit lineage tied to canonical business effects;
- sink outage cannot erase critical audit history;
- reconstruction/projector proof;
- tamper-evident integrity.

### Gate C — sensitive evidence

Required:

- encryption;
- brokered access;
- retention/deletion/legal hold;
- HSEC residency proof;
- evidence access audit.

### Gate D — AI/harness forensic convergence

Required:

- HSEC trusted execution envelope;
- HLEARN structured decisions/tools/evidence;
- action draft/approval/ERP causality;
- source provenance links;
- hidden chain-of-thought absent.

### Gate E — regulated/strict-residency tenants

Required:

- processor/storage region attestation;
- complete data-copy inventory;
- deletion canaries;
- support/operator access controls;
- policy-driven retention proof;
- export lifecycle certification.

---

## 41. Definition of done

The introspection layer is not complete merely because requests appear in a log table.

It is complete when an authorized organization investigator can answer, with bounded privacy exposure:

```text
Who initiated this?
Which identity/session/source did it come from?
What operation or read happened?
Which organization/company scope applied?
Which policy authorized or denied it?
What release/schema executed it?
What business record changed?
What downstream effect occurred?
Which approval/workflow/agent caused it?
Which source/evidence supported an AI-originated action?
Was the event later exported or inspected by an admin?
Can integrity of the forensic record be verified?
Has all evidence obeyed retention/residency policy?
```

And simultaneously:

```text
No raw secrets were copied.
No cross-org correlation key was exposed.
No audit query bypassed Casbin.
No ordinary query response was duplicated into a shadow data lake by default.
No sensitive evidence escaped retention/residency governance.
No hidden chain-of-thought was stored.
```

---

## 42. Relationship to the planning stack

```text
PR #38 / INT-PLAN
ERP workflow integration
       ↓
PR #39 / ADV-PLAN
business-invariant adversarial certification
       ↓
PR #40 / HSEC-PLAN
harness security, residency, retention and sandbox certification
       ↓
PR #41 / HLEARN-PLAN
trace, correction, replay, comparison and organization learning
       ↓
INTRO-PLAN
forensic introspection, privacy-preserving audit and causality
```

Each lower layer constrains INTRO:

- **INT** defines stable semantic business operations and workflows;
- **ADV** defines correctness/tenancy/idempotency invariants to certify;
- **HSEC** defines authority, residency, retention and sandbox/data-copy constraints;
- **HLEARN** defines structured decision/evidence/replay records without hidden reasoning;
- **INTRO** makes the combined system inspectable, causally navigable and auditable by authorized organization administrators.

---

## 43. Explicit non-goals

This plan does **not** introduce:

- universal raw request/response retention;
- arbitrary admin SQL;
- downloadable organization hashing keys;
- globally stable employee identifiers;
- hidden chain-of-thought capture;
- Kafka as a mandatory first implementation;
- a second authorization engine;
- a second business-state engine;
- unrestricted platform-operator access to customer evidence;
- indefinite log retention;
- a parallel AI-only audit system.

The intended result is a privacy-first forensic layer that is useful precisely because it records trusted semantics and causality rather than indiscriminately copying every byte that passed through the system.
