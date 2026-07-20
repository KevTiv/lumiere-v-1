# Workflow and approvals investigation

**Verified:** 2026-07-19  
**Repository revision:** `48b006b3a`  
**Benchmark:** NetSuite SuiteFlow and OneWorld quality characteristics, not feature or wire compatibility

## Executive finding

Lumiere has two related but only loosely connected implementations:

1. a graph-shaped workflow definition/runtime with five public tables and nine UI-callable reducers; and
2. a threshold approval gate with two public tables and six UI-callable reducers.

The approval gate is the more operationally real surface. It blocks selected accounting and ERP actions, creates a unified inbox request, prevents self-approval, and invokes the guarded domain mutation inside the approval reducer transaction. The generic workflow runtime can create a graph, start an instance, follow a named signal, mark an exception, and cancel. It does **not** evaluate stored conditions, respect split/join modes, execute activities, enforce transition groups, create human tasks, run timers, retry work, compensate, migrate instances, or prevent duplicate starts/signals.

The current engine is therefore **unsuitable as a control plane for accounting or regulated approvals** despite containing fields that imply those capabilities. It is a useful schema prototype and UI shell. The path forward is to preserve the working approval/domain integration while replacing mutable graph execution with immutable versions, deterministic decisions, append-only history, explicit human tasks, and durable timer/outbox delivery.

## Benchmark and grading

The benchmark is the operational quality demonstrated by NetSuite SuiteFlow: record-bound workflows, state/action/transition conditions, permissions, scheduled execution, and inspectable workflow history. Oracle documents conditions on actions and transitions and scheduled workflow instances in [SuiteFlow Overview](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4068260113.html), and deterministic action-before-transition ordering in [SuiteFlow Trigger Execution Model](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4077993199.html). Lumiere does not need to copy SuiteFlow's editor, trigger names, or record model.

Ratings:

- **Present** — works end to end with an enforced domain consequence.
- **Partial** — meaningful implementation exists but a required control, lifecycle, UI, or test layer is missing.
- **Absent** — no meaningful implementation was found.
- **Unsuitable** — a surface exists but relying on it would violate a required correctness or control invariant.

Priorities:

- **Pilot-critical** — required before workflows can authorize money, inventory, payroll, or external effects.
- **Competitive** — required to meet the enterprise workflow quality bar.
- **Differentiating** — a credible advantage for Lumiere's target geographies or operating model.

## 1. Verified inventory

### 1.1 Tables

| Table | Purpose | Scope/index evidence | Operational assessment |
|---|---|---|---|
| `workflow` | Mutable graph header | Organization indexes; optional `company_id` | Definition and runtime identity are conflated; no version |
| `workflow_activity` | Node with kind, action, split/join, subflow and state metadata | Organization copied from parent; workflow index | Many stored controls are not executed |
| `workflow_transition` | Edge with signal, condition, expression and permission group | Organization copied; from/to indexes | Runtime matches only `signal` |
| `workflow_instance` | Record-bound running instance | Organization/workflow/resource indexes | No company, version, revision, terminal reason or result |
| `workflow_workitem` | Active token at an activity | Instance/activity indexes | Not a claimable human or service task |
| `approval_rule` | Threshold/discount gate | Organization/model indexes; optional company | Mutable rule, `f64` threshold, first-match only |
| `approval_request` | Pending/reviewed action request | Organization/status/model indexes; required company | Real inbox and guarded execution; no unique semantic key |
| `queue_job` *(adjacent)* | Pending/scheduled external work | Organization/queue indexes | Useful base; no lease owner/expiry or idempotency key |
| `queue_worker` *(adjacent)* | Registered worker heartbeat | Organization index | Registration/heartbeat only; no ownership linkage to jobs |
| `audit_log` / `mail_message` *(adjacent)* | Mutation audit and notifications | Shared platform tables | Used by core approval/workflow reducers, uneven detail |

The seven workflow/approval tables are public. Client visibility is therefore controlled primarily through organization-scoped BFF SQL and subscription builders, not by table privacy.

### 1.2 Reducers and internal execution

**Workflow definition and import (5):**

`create_workflow`, `add_workflow_activity`, `add_workflow_transition`, `set_workflow_active`, `import_workflow_csv`

**Workflow runtime (4):**

`start_workflow`, `signal_workflow`, `set_workitem_exception`, `cancel_workflow_instance`

**Approval rules and decisions (6):**

`create_approval_rule`, `update_approval_rule`, `set_approval_rule_active`, `delete_approval_rule`, `approve_approval_request`, `reject_approval_request`

**Approval helpers:**

- `gate_action_with_approval` checks for an approved request, reuses a pending request, selects the first matching active rule, and inserts a request.
- `execute_approved_action` has a fixed allowlist: purchase confirm/send, sales confirm, journal posting, payment posting, expense approval, and AI action-draft approval.
- Approving invokes the domain `*_impl` function before marking the request approved, so both succeed or roll back in one reducer transaction.
- Rejecting PO/SO requests returns the source document from `ToApprove` to `Draft`; AI draft rejection invokes its domain core.
- `notify_approval_event` writes a `mail_message` notification.

**Adjacent queue reducers:**

`enqueue_job`, `claim_queue_job`, `complete_queue_job`, `register_queue_worker`, `worker_heartbeat`

### 1.3 Subscriptions and query surfaces

The workflow workspace subscribes to exactly five organization-scoped resources:

`workflows`, `workflow-activities`, `workflow-transitions`, `workflow-instances`, `workflow-workitems`

All five occur in the resource registry, generated row-type map, subscription resource list, and full-client subscription list. Mutation hints invalidate all five after every workflow mutation. Query ordering exists for activities, transitions, and workitems.

Approvals expose three query resources:

- `approval-rules`
- `approval-requests`
- `approval-requests-inbox` (`status = 'pending'`)

They are custom organization-scoped SQL branches in `api-server/src/query_exec.rs`; the inbox and full request list are sorted by ID descending in Rust. Approval resources are not part of `WORKFLOWS_WORKSPACE_RESOURCE_KEYS`, so their UI relies on query invalidation rather than the workflow workspace subscription.

**Control gap:** approval queries filter by organization, not by the selected company or approver. The UI filters pending state, but the server returns all organization requests to any identity with resource access. Field/resource policy may reduce visibility, but assignment-specific row authorization is absent.

### 1.4 UI operations

#### `/workflows`

- Dashboard counts definitions and active/completed instances.
- Create definition and CSV import.
- Activate/deactivate definition.
- Add an activity and transition.
- Start an instance for an arbitrary record type/ID.
- Send an arbitrary signal.
- Cancel an instance or mark a workitem exception.
- Inspect definitions, instances, activities, and workitems.

There is no visual graph validator, draft/publish lifecycle, simulation, version history, human inbox, timer/retry view, migration tool, decision trace, or per-node execution result.

#### `/approvals`

- Unified pending inbox with record links and AI-draft badges.
- Approve or reject; rejection requires a reason.
- List approval rules and create a threshold/discount rule.
- Hooks and BFF commands also support update, activation, and delete, but the inspected page does not expose those operations.

The create form does not configure `approver_role_id`, multi-step routes, assignment, deadlines, delegation, escalation, or localized calendars. Most labels on the approval page are hard-coded English rather than i18n keys.

### 1.5 Tests

| Layer | Verified coverage | Important omissions |
|---|---|---|
| SpacetimeDB platform domain | Creates one workflow and checks model/name persistence | No activity, transition, runtime, condition, tenant attack, duplicate signal, or cancellation semantics |
| Expense domain | Exercises a deferred approval request around an expense operation | Does not execute a general workflow graph |
| Approval E2E | Creates PO threshold rule, blocks confirmation, finds pending request, rejects in UI | No approve-and-post, role assignment, self-approval, concurrency, or company visibility |
| AI harness E2E | Red-risk draft is bridged to pending approval | No duplicate execution/replay proof |
| Workflow E2E | Module loads and new-workflow action is visible | No lifecycle mutation or runtime assertion |
| Contract/BFF | Reducer name sets align with the 15 exposed workflow/approval reducers | No backend existence assertion tied to CI and no semantic contract tests |

No dedicated workflow test module exists under `spacetimedb/tests/workflow`. There are no load, recovery, timer, migration, branch/join, compensation, or localization tests.

### 1.6 Evidence map

| Surface | Primary source |
|---|---|
| Definitions, activities, transitions | [`spacetimedb/src/workflow/definitions.rs`](../spacetimedb/src/workflow/definitions.rs) |
| Instances and workitems | [`spacetimedb/src/workflow/runtime.rs`](../spacetimedb/src/workflow/runtime.rs) |
| Approval rules/requests and guarded execution | [`spacetimedb/src/workflow/approvals.rs`](../spacetimedb/src/workflow/approvals.rs), [`approval_gate.rs`](../spacetimedb/src/workflow/approval_gate.rs) |
| Generic durable queue | [`spacetimedb/src/core/queue.rs`](../spacetimedb/src/core/queue.rs) |
| Country/HR pack foundations | [`spacetimedb/src/core/country_pack.rs`](../spacetimedb/src/core/country_pack.rs), [`hr/country_pack_hr.rs`](../spacetimedb/src/hr/country_pack_hr.rs) |
| Workflow query hooks and BFF contracts | [`frontend/packages/query-hooks/src/hooks/workflows.ts`](../frontend/packages/query-hooks/src/hooks/workflows.ts), [`frontend/packages/stdb/src/commands/workflows-http.ts`](../frontend/packages/stdb/src/commands/workflows-http.ts) |
| Approval query hooks and BFF contracts | [`frontend/packages/query-hooks/src/hooks/approvals.ts`](../frontend/packages/query-hooks/src/hooks/approvals.ts), [`frontend/packages/stdb/src/commands/approvals-http.ts`](../frontend/packages/stdb/src/commands/approvals-http.ts) |
| Workspace subscriptions | [`frontend/packages/stdb/src/subscriptions/workflows-workspace.ts`](../frontend/packages/stdb/src/subscriptions/workflows-workspace.ts) |
| UI operations | [`frontend/web/app/(modules)/workflows/workflows-client.tsx`](<../frontend/web/app/(modules)/workflows/workflows-client.tsx>), [`approvals-client.tsx`](<../frontend/web/app/(modules)/approvals/approvals-client.tsx>) |
| Domain/E2E evidence | [`spacetimedb/tests/platform/platform_smoke.rs`](../spacetimedb/tests/platform/platform_smoke.rs), [`frontend/web/tests/e2e/parity-phase3-approvals-documents-mutations.spec.ts`](../frontend/web/tests/e2e/parity-phase3-approvals-documents-mutations.spec.ts) |

## 2. Architecture gap matrix

| Capability | State | Evidence and gap | Priority |
|---|---|---|---|
| Record-bound definitions and instances | **Partial** | Model/resource binding exists; instance does not verify the definition is active or that resource type matches | Pilot-critical |
| Versioned immutable definitions | **Absent** | Definitions, nodes and transitions mutate in place; instances store only `workflow_id` | Pilot-critical |
| Conditions | **Unsuitable** | `condition` and expression IDs are stored, but `signal_workflow` never evaluates them | Pilot-critical |
| Deterministic execution order | **Unsuitable** | Sequence fields exist; runtime iteration/first-start selection is not a validated execution model | Pilot-critical |
| Approval gating | **Present** (narrow) | Selected domain actions block and execute transactionally after approval | Pilot-critical |
| Approver assignment/role enforcement | **Unsuitable** | Rule stores `approver_role_id`; approval reducer only checks general write permission and self-approval | Pilot-critical |
| Segregation of duties | **Partial** | Self-approval denied and platform SOD primitives exist; workflow-specific conflicting roles and delegation are absent | Pilot-critical |
| Complete decision history | **Partial** | Approval status and generic audit rows exist; condition inputs/results and full runtime transitions do not | Pilot-critical |
| Duplicate start/signal/action protection | **Unsuitable** | No semantic unique key or expected revision; repeated starts and signals can create duplicate instances/workitems | Pilot-critical |
| Human tasks | **Absent** | Workitems have no assignee, candidates, claim, due date, form, outcome or comment | Pilot-critical |
| Timers and deadlines | **Absent** | No workflow timer; generic queue has `scheduled_at` but is not integrated | Pilot-critical |
| External durable outbox | **Partial** | Generic queue is durable in SpacetimeDB; no atomic workflow outbox contract or workflow worker | Pilot-critical |
| Worker leasing/recovery | **Unsuitable** | Claim changes status to Processing permanently if a worker dies; heartbeat does not reclaim work | Pilot-critical |
| Retry/backoff/dead letter | **Partial** | Attempts/max-attempts exist; retry is immediate and there is no backoff, lease, attempt log or admin recovery | Pilot-critical |
| Parallel split/join | **Unsuitable** | Split/join fields exist but runtime advances every signal match without join accounting or dedupe | Competitive |
| Delegation | **Absent** | Purchase-specific delegation exists elsewhere; no organizational workflow delegation | Competitive |
| Escalation | **Absent** | No deadline or escalation rule/task reassignment | Competitive |
| Compensation | **Absent** | Cancel marks workitems/instance complete; it does not reverse effects | Competitive |
| Simulation | **Absent** | No read-only evaluator, fixture inputs, trace, or side-effect suppression contract | Competitive |
| Active-instance migration | **Absent** | No version or node mapping; in-place definition edits silently affect instances | Pilot-critical |
| Subflows | **Unsuitable** | `subflow_id` is stored but never executed | Competitive |
| Action execution/extensibility | **Partial** | Approval action allowlist is safe and real; generic workflow `action` strings are inert | Competitive |
| Drill-down reporting | **Partial** | UI lists rows and approval record links; no definition→instance→decision→effect trace | Competitive |
| Multi-company/entity behavior | **Unsuitable** | Definition may have company, instance/workitem do not; approval query visibility is org-wide | Pilot-critical |
| Local time zones/working days | **Absent** | No workflow calendar; HR/project holiday data is not connected | Pilot-critical |
| Geography-specific workflow packs | **Absent** | Country packs exist for ten markets but contain no workflow definitions/policies | Differentiating |
| Internationalized UI | **Partial** | Workflow module uses i18n; approval inbox is mostly English-only | Competitive |
| Definition lifecycle/export/import | **Partial** | Create/activate/CSV header import; no validation, immutable publish, signed export, dependency check or rollback | Competitive |
| Reliable integrations | **Partial** | External workers in other domains establish a pattern; workflow has no explicit boundary | Pilot-critical |

## 3. Required invariants

### 3.1 Accounting

1. A workflow may authorize a domain command but never write journal, payment, invoice, stock, payroll, or tax state directly.
2. Approval consumption and the guarded domain mutation commit in the same reducer transaction. Failure leaves the request pending and the domain record unchanged.
3. Posted accounting records remain balanced, company-scoped, currency-correct, period-unlocked, and immutable under the accounting module's existing rules.
4. Approval conditions use fixed-point decimal or currency minor units, never binary `f64`. The currency and rate/date basis are captured with the decision.
5. A decision binds to a record revision or content hash. Material changes after request creation invalidate or re-evaluate the approval.
6. Rejection, cancellation, compensation and migration never silently reverse posted accounting. They create an explicit domain reversal or a human exception.
7. Every financial effect is drillable to source record, workflow/version, instance, task, decision, actor and reducer receipt.

### 3.2 Authorization and isolation

1. Every definition/runtime/outbox row carries `organization_id`; every company-bound row carries `company_id`.
2. Scope is derived and verified server-side. Child rows must match their parent organization/company.
3. Only published and active versions may start; only authorized principals may signal or complete a task.
4. Candidate role/group/unit membership is re-evaluated at action time. Assignment alone is not authorization.
5. Requesters cannot approve their own work. Configured SOD conflicts also apply to delegates, escalated actors, administrators and service identities unless an audited break-glass policy explicitly allows it.
6. Delegation is organization/company bounded, time bounded, revocable and cycle-free, and records both delegator and acting identity.
7. Inbox subscriptions/queries expose only tasks the caller may view or act on; organization-wide pending approvals are not a default end-user view.
8. Service workers use a least-privilege identity limited to claim/result reducers and allowed queue partitions.

### 3.3 Audit and lifecycle

1. Published definition versions are immutable and content-hashed.
2. Runtime history is append-only. Current-state rows are projections, not the sole evidence.
3. Each event records instance/version, prior and next state, token/task, actor/service identity, delegation chain, event/idempotency key, input hash, evaluated conditions, outcome/reason, timestamp and correlation/causation IDs.
4. Simulation is explicitly marked and cannot mutate domain/runtime/outbox tables.
5. Migration records source/target versions, mapping, preflight result, operator, reason and per-instance result. History is never rewritten.
6. Timer calculation records calendar version, time zone, local due time, UTC instant and DST resolution policy.
7. Retry/compensation attempts are separate immutable events; error text is redacted according to data classification.
8. Definition retirement does not delete versions referenced by instances or audit history.

### 3.4 Concurrency and delivery

1. Commands carry `expected_revision` or expected lifecycle state; stale commands fail without effects.
2. A semantic `idempotency_key` is unique within organization + command/effect scope. The same key and same input returns the prior receipt; the same key with different input fails.
3. Starting the same trigger for the same record/version is unique where the trigger policy is singleton.
4. A work token can complete once. Parallel joins fire once after the required distinct branches arrive.
5. Timer cancellation and firing race in one reducer serialization order; the loser becomes a recorded no-op.
6. A worker lease has owner and expiry. Expired Processing work becomes reclaimable without losing attempt history.
7. External delivery is at least once. Exactly-once business effect is obtained through stable external idempotency keys plus local execution receipts, not assumed from the transport.
8. External success is recorded through a reducer that verifies lease, attempt, instance revision and effect key before advancing the workflow.
9. Compensation is itself idempotent, retryable and independently auditable.
10. Reducer transactions remain short and contain no external I/O.

## 4. Reference workflows

### 4.1 Purchase/bill approval and posting

1. PO submit snapshots amount, currency, vendor risk, company and record revision.
2. Typed conditions select the published company pack and approval path.
3. Procurement manager approves; Finance approval is added above its localized threshold.
4. Self-approval/SOD/delegation checks run at each decision.
5. A working-day timer escalates an overdue task using the company's local calendar.
6. Final approval invokes the existing PO/domain confirmation reducer atomically and consumes the approval.
7. Bill match/post remains a separate controlled domain action linked to the same trace.

### 4.2 Cross-entity order with parallel controls

1. An intercompany order starts a version pinned for both participating companies.
2. Finance and Operations branches run in parallel with company-specific candidate groups.
3. The AND join advances only after both unique tokens complete.
4. Failure in fulfillment after an external reservation schedules a compensating release.
5. Accounting elimination/posting uses domain reducers and retains separate company audit links.

### 4.3 Reliable external integration

1. A reducer transition writes the next runtime state, a workflow outbox item and audit event atomically.
2. The worker claims the item with a lease and stable effect key.
3. It calls the external service outside SpacetimeDB.
4. Success is recorded by reducer and advances once; duplicate callbacks return the existing receipt.
5. Transient failures retry with bounded exponential backoff and jitter.
6. Exhausted work enters dead-letter state and creates an authorized human recovery task.
7. Operator retry creates a new attempt under the same semantic effect, preserving the prior history.

## 5. Localization matrix

Country packs must contain versioned policy/configuration, not statutory logic embedded in reducers. Holiday data needs an effective year and source because governments may add or move holidays. Defaults below are product defaults, subject to company override and official pack updates.

| Region / pack | Locale and time zone requirements | Working-day/holiday requirements | Workflow-pack requirements | Current state |
|---|---|---|---|---|
| Oceania — AU | `en-AU`; IANA zone per state/territory; DST varies by jurisdiction | Mon–Fri default; national plus state/territory/regional holidays and substitute days | GST/FBT evidence holds, state-aware deadlines, AUD minor units, local delegation/escalation templates | Country/tax/expense pack partial; workflow pack absent |
| Oceania — NZ | `en-NZ` plus Māori-capable labels; `Pacific/Auckland` or `Pacific/Chatham` | Mon–Fri; national, Mondayised, Matariki, and regional anniversary dates | GST evidence, observed-day rules, NZD minor units, local approval wording | Country/HR pack partial; workflow pack absent |
| Southern Africa — ZA | `en-ZA` baseline with translatable labels; `Africa/Johannesburg` | Mon–Fri default; Public Holidays Act observed-Monday behavior | ZAR minor units, VAT evidence, POPIA-aware task visibility, local procurement/expense routes | Country/HR pack partial; workflow pack absent |
| Brazil — BR | `pt-BR`; IANA zone by establishment | Mon–Fri; federal, state and municipal holidays; distinguish holiday from optional public-service day | BRL minor units, CNPJ/CPF context, tax/document review tasks, Portuguese decisions | Country/tax/expense pack partial; workflow pack absent |
| Southern Cone — AR | `es-AR`; IANA zone by establishment | Mon–Fri; national and movable/bridge holidays, provincial/local overlays | ARS precision policy, CUIT context, localized approval/rejection reasons | Country pack partial; workflow pack absent |
| Southern Cone — CL | `es-CL`; `America/Santiago` plus territory exceptions | Mon–Fri; national and regional holidays; DST rule updates | CLP zero-minor-unit display where applicable, RUT context, tax-document tasks | Country pack partial; workflow pack absent |
| Maritime SE Asia — SG | `en-SG` baseline with multilingual content support; `Asia/Singapore` | Mon–Fri default; gazetted holidays and substitute rules | SGD minor units, UEN context, GST evidence, compact one-company approval pack | Country/tax/expense pack partial; workflow pack absent |
| Maritime SE Asia — MY | `ms-MY` and `en-MY`; zone and state required | State-dependent workweek and federal/state holidays; Sabah/Sarawak distinctions | MYR minor units, state calendar selection, SST/evidence tasks, multilingual notices | Country pack partial; workflow pack absent |
| Maritime SE Asia — ID | `id-ID`; IANA zone by establishment (WIB/WITA/WIT) | Company-configurable workweek; national holidays and collective-leave days are distinct | IDR zero-minor-unit display where applicable, NPWP context, local tax/evidence review | Country pack partial; workflow pack absent |
| Maritime SE Asia — PH | `en-PH` and Filipino-capable labels; `Asia/Manila` | Mon–Fri default; regular vs special holidays and local proclamations | PHP minor units, TIN/context validation when added, category-aware deadlines and notices | Country pack partial; workflow pack absent |

Calendar engine rules:

- Store IANA zone names; never store only a UTC offset.
- Resolve deadlines in local wall time, then persist local and UTC values.
- For nonexistent DST time, move forward to the first valid instant; for ambiguous time, select the earlier instant unless the pack overrides it. Record the resolution.
- Support national → subdivision → locality → company calendars with explicit precedence and additive/excluded dates.
- Separate non-working holidays, optional/collective leave, and display-only observances.
- Version calendars and pin each scheduled timer to the version used for calculation. A later calendar update must produce an explicit recomputation event, not silently move a deadline.

Official baseline sources include [Australian Fair Work public holidays](https://www.fairwork.gov.au/tools-and-resources/fact-sheets/minimum-workplace-entitlements/public-holidays), [Employment New Zealand public holidays and anniversary dates](https://www.employment.govt.nz/leave-and-holidays/public-holidays/public-holidays-and-anniversary-dates), [South African Government public holidays](https://www.gov.za/ss/about-sa/public-holidays), [Brazil federal holiday publications](https://www.gov.br/gestao/pt-br/assuntos/noticias), and [Malaysia Cabinet Division holiday acts and gazettes](https://www.kabinet.gov.my/akta-dan-warta/). Each annual pack release must cite the applicable official national and subdivision sources for all ten markets.

## 6. SpacetimeDB architecture decision

### Decision

SpacetimeDB is the authoritative workflow state, decision history, timer intent, outbox and execution-receipt store. All state transitions occur in transactional reducers. A standalone Rust workflow worker provides durable scheduling reconciliation and external I/O. Subscriptions provide low-latency UI/worker wakeups, but bounded polling is the recovery mechanism.

SpacetimeDB 2.0.1 is used by this repository. Its reducers are atomic and isolated, and failed reducers roll back all database changes; procedures can perform I/O but do not make a whole multi-transaction operation atomic. See [Transactions and Atomicity](https://spacetimedb.com/docs/databases/transactions-atomicity/). Reducers also cannot perform network or filesystem I/O; see [Reducers](https://spacetimedb.com/docs/functions/reducers/). Those constraints fit a transactional-outbox design.

### Definition model

- `workflow_definition`: stable logical identity and ownership.
- `workflow_version`: immutable draft/published/retired version, schema version and content hash.
- `workflow_node` / `workflow_edge`: version-owned normalized graph or a canonical validated document plus indexes.
- Conditions are a versioned typed AST. No arbitrary Rust, JavaScript, SQL, reducer name, or free-form expression is evaluated.
- Publishing validates exactly one allowed start strategy, reachable terminal nodes, node/edge types, join structure, action registry references, pack/calendar dependencies and permission references.

### Runtime model

- `workflow_instance`: version pin, record/company scope, revision, status and terminal reason.
- `workflow_token`: branch-safe execution token with unique lineage and state.
- `workflow_human_task`: candidate policy, assignee, due time, outcome and form/input schema.
- `workflow_decision_event`: append-only event/condition/actor history.
- `workflow_timer`: durable business timer with local/UTC due data and calendar version.
- `workflow_outbox`: external effect or notification intent.
- `workflow_execution_attempt`: immutable claim/retry/error history.
- `workflow_execution_receipt`: unique semantic effect and result fingerprint.
- `workflow_migration_plan` / result: version/node mappings and per-instance outcome.

Current-state tables are projections updated alongside the event row in one reducer. Event history is not an event-sourced replay dependency for the pilot; it is authoritative evidence, while projections remain the operational read model.

### Transaction and isolation boundary

One reducer transaction may:

1. validate scope, authorization, expected revision and idempotency;
2. evaluate deterministic conditions against an explicit snapshot;
3. consume/create tokens and tasks;
4. invoke an in-process domain `*_impl` action when it must commit atomically;
5. insert decision, timer, outbox and receipt rows; and
6. update the instance projection.

External calls, sleeps, large reports, and unbounded graph traversal are prohibited in this transaction. Complex cascades execute as bounded steps across transactions and are connected by durable intents.

### Scheduler and external-service boundary

Harden the existing queue pattern rather than introducing a second generic queue:

- add `dedupe_key`, `available_at`, `lease_owner`, `lease_expires_at`, `last_attempt_at`, backoff policy, correlation IDs and dead-letter metadata;
- add a unique semantic receipt table because queue status alone cannot prove exactly-once effects;
- claim via reducer only when due and unleased/expired;
- record result via reducer only when owner, lease, attempt and effect key match;
- make completion of a workflow outbox intent and runtime advancement atomic;
- reconcile abandoned leases and due timers by bounded indexes;
- keep payloads versioned and free of secrets; store secret references only.

The worker may subscribe to due/outbox changes for latency. It must also poll on startup and periodically because correctness cannot depend on a permanently connected subscriber. SpacetimeDB delivers transaction updates atomically and initializes subscriptions from a committed snapshot ([Subscription Semantics](https://spacetimedb.com/docs/clients/subscriptions/semantics/)).

### Scale

- Partition workers by queue and stable organization shard; never let two workers own the same live lease.
- Index status + available/due time, organization/company, instance/version, assignee/candidate lookup, lease expiry and dedupe key.
- Use bounded page sizes and backpressure; avoid subscriptions to all history/outbox rows.
- Separate operational inbox/current-state subscriptions from paginated audit history.
- Measure reducer duration, claim latency, timer lateness, attempts, dead letters, active tasks/instances and subscription row counts.
- Archive/export terminal history by retention policy without deleting definition versions or financial evidence still referenced.

### Active workflow migration

Published versions never change under an instance. Default behavior is to let existing instances drain on their pinned version. Explicit migration requires:

1. a source/target version and mapping for every active node/token/task;
2. compatibility checks for task inputs, action schemas, calendars and branch topology;
3. side-effect-free simulation with the instance snapshot;
4. operator authorization, reason and selected instance set;
5. an atomic per-instance reducer using expected revision; and
6. append-only success/failure evidence.

Bulk migration is a worker-coordinated series of per-instance transactions, not one unbounded reducer. Incompatible instances remain pinned and are reported; they are never guessed into a new state.

## 7. Acceptance scenarios

| ID | Scenario and expected result | Priority |
|---|---|---|
| WF-01 | Publish v1, then reject node/edge mutation; content hash remains stable | Pilot-critical |
| WF-02 | Start against active v1, publish v2, and prove the running instance remains on v1 | Pilot-critical |
| WF-03 | Evaluate a typed amount/currency condition twice from the same snapshot and obtain the same path and trace | Pilot-critical |
| WF-04 | Reject a requester's self-approval, wrong-role approval, SOD-conflicting approval and out-of-scope company approval | Pilot-critical |
| WF-05 | Approve a journal/payment request and commit approval consumption plus balanced domain posting atomically; domain failure leaves both unchanged | Pilot-critical |
| WF-06 | Send the same start/signal/task command concurrently with one idempotency key; exactly one instance/token/effect results | Pilot-critical |
| WF-07 | Fork Finance and Operations branches; duplicate branch completion is a no-op receipt and the AND join fires exactly once | Competitive |
| WF-08 | Delegate a task within scope/date limits; record delegator and actor; reject expired, cross-company and cyclic delegation | Competitive |
| WF-09 | Calculate an AU/NZ regional or MY state deadline across a weekend/holiday/DST boundary and preserve local plus UTC evidence | Pilot-critical |
| WF-10 | Stop the worker past a timer due time, restart it, and fire the timer once within the lateness SLO | Pilot-critical |
| WF-11 | Lose a worker after external success but before local completion; replay with the same effect key and advance once | Pilot-critical |
| WF-12 | Retry transient failures with backoff, dead-letter after the limit, then perform an authorized audited manual retry | Pilot-critical |
| WF-13 | Compensate an external reservation after a later branch failure; duplicate compensation does not repeat the reversal | Competitive |
| WF-14 | Simulate a definition and return ordered conditions/tasks/effects without changing runtime, domain, timer, outbox or audit tables | Competitive |
| WF-15 | Migrate a compatible active instance to v2 with a recorded mapping; reject an incompatible branch/task migration and leave it on v1 | Competitive |
| WF-16 | Subscribe as users in another organization/company or without candidate rights and receive no inaccessible task/request rows | Pilot-critical |
| WF-17 | Drill from a posted financial record through approval, workflow version, conditions, timer/retries, actors and effect receipt | Competitive |
| WF-18 | Activate each of the ten geography packs and validate locale, zone, working-day calendar, translated notices and pack-version pin | Differentiating |

## 8. Recommended delivery order

### Pilot-critical

1. Immutable definition/version model, typed condition schema and publish validator.
2. Scoped runtime model with revisions, idempotency receipts and append-only decision events.
3. Human tasks with approver role/candidate enforcement, SOD and record-revision binding.
4. Atomic guarded-action adapter registry preserving existing approval behavior.
5. Durable timers/outbox plus hardened queue leases, retry/backoff, dead letter and worker reconciliation.
6. Per-user/company inbox subscriptions and financial/audit drill-down.
7. Domain and concurrency tests for WF-01 through WF-06 and WF-09 through WF-12/WF-16.

### Competitive

1. Parallel tokens and validated split/join semantics.
2. Delegation, escalation and localized working-time administration.
3. Simulation, trace viewer and safe active-instance migration.
4. Compensation handlers and operator recovery UI.
5. Definition export/import, compatibility validation and lifecycle dashboards.

### Differentiating

1. Versioned AU/NZ/ZA/BR/AR/CL/SG/MY/ID/PH workflow packs.
2. Explainable localized simulation and deadline previews.
3. Cross-entity orchestration packs with company-specific authorization and accounting links.
4. Pack update impact analysis for active definitions, timers and instances.

The build-ready tranche plan is in [`plans/workflow-approvals-gap-fixes-plan.md`](./plans/workflow-approvals-gap-fixes-plan.md).
