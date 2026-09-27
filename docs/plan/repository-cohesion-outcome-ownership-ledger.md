# Repository cohesion and outcome-ownership execution ledger

**Status:** INITIAL EXECUTION LEDGER — 2026-09-14  
**Parent plan:** [`repository-cohesion-outcome-ownership-plan.md`](./repository-cohesion-outcome-ownership-plan.md)  
**Program:** [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)

This ledger is a mandatory pre-feature seam-eradication track. It does not replace `BASE`, `GOV`, `SEC`, or later work. It removes the duplicate authority paths those packages would otherwise inherit.

Status values follow the main ERP harness ledger: `TODO`, `ACTIVE`, `REVIEW`, `BLOCKED`, `ACCEPTED`, `DEFERRED`.

## 1. Coordination rule

After `BASE-00`/`BASE-02` establish the accepted implementation and contracts baseline, `COH-00` must be accepted before assigning the remaining COH packages.

`COH-01`, `COH-02`, `COH-03`, and `COH-04` are intentionally parallelizable when file ownership is disjoint. The coordinator integrates their shared types/wiring.

Existing code from the harness implementation stack should be **adapted**, not rewritten merely to satisfy the new task IDs.

## 2. Work packages

| ID | Est. | Depends | Primary ownership | Bounded objective | Acceptance gate |
| --- | ---: | --- | --- | --- | --- |
| `COH-00` | 1 | BASE-00, BASE-02 | audit/docs/tests only | Produce the exact authority/compatibility census: every production AI route, execution path, spend path, draft creation path, policy/permission map, structural contract registry, scope source, and compatibility fallback. Record call sites and chosen canonical owner. No behavior changes. | Coordinator can point to one intended owner and one deletion/migration task for every duplicate path; no unknown production AI route remains unclassified. |
| `COH-01` | 1.5 | COH-00 | AI gateway auth/context seam + route DTOs | Introduce/standardize the server-derived trusted execution context for protected AI services. Remove normal service dependency on request-provided `stdb_token`, `identity_hex`, org/role authority; bind company from validated user intent/current scope. Coordinate with SEC-00 so there is one context/envelope lineage. | Governed service entry points receive trusted context; forged org/company/identity/token request fields cannot widen authority; current permission is still rechecked at protected calls. |
| `COH-02` | 1.5 | COH-00 | gateway/API error types + focused frontend client adapter | Define typed service-error classification and operation outcome semantics (`Applied`, replay/no-op, rejected, waiting, outcome-unknown). Add one transport envelope/mapping seam for the pilot path; preserve correlation and retry advice. Do not introduce one giant cross-repo error enum. | Validation/authorization/conflict/budget/stale/unknown-outcome fixtures map to stable codes/status/retry semantics; expected failures no longer become generic 500/string parsing on the pilot path; internal detail is not leaked. |
| `COH-03` | 1.5 | COH-00 | agent/capability resolution | Replace duplicate `ensure_allowed_action` / `agent_allows_action` implication behavior with one effective capability calculation. Agent configuration may narrow authority but cannot grant it. Isolate legacy stored-action normalization behind one tested compatibility adapter with removal gate. | Same actor/agent/skill produces the same effective capability set across route, registry, policy and tool execution; removing a permission affects next protected call; no runtime scattered implication map remains on admitted paths. |
| `COH-04` | 1.5 | COH-00 | release registry / manifest loader / certification adapter | Make the complete immutable released manifest the runtime/certification policy truth. Compiled adapters provide executable implementation only; remove policy reconstruction/overlay duplication where fields already belong to the release. | Certification and runtime parse/validate the same canonical manifest bytes/version/hash; changing released risk/resources/limits/capabilities changes runtime policy without editing compiled policy constants; incompatible adapter/version fails closed. |
| `COH-05` | 2x | COH-03, COH-04 | codegen capability/resource adapter + invocation scope seam | Replace handwritten structural resource-contract duplication with generated application/capability descriptors plus minimal harness policy overlays. Unify scope rule: org/company authority is server-bound; ordinary model-facing schemas do not accept authority IDs. Release/pin through the normal producer→release→consumer protocol if IR changes are required. | Generated schema, policy evaluation, and runtime tool adapter enforce one scope contract; no model-provided org/company authority; structural input/output/risk/result metadata has one generated source; handwritten registry retains only truly harness-specific semantics. |
| `COH-06` | 1.5 | COH-01, COH-02 | run/draft create protocols + STDB correlation tables/operations as needed | Remove create→query-latest identity recovery from governed action drafts and harden run lookup correlation. Standardize exact request/run/idempotency binding for consequential creates; validate org/company/run cardinality. | Concurrent/retried draft and run creation resolves the exact same intended effect; create-commit + response-loss is idempotent/reconcilable; no governed path uses `ORDER BY id DESC`/latest-row discovery as correctness. |
| `COH-07` | 2x | COH-01..06 | canonical executor, legacy orchestrator, spend path, route classification | Collapse production AI execution onto the canonical governed executor. Remove/development-isolate `run_skill_unlocked` production reachability, legacy best-effort budget/spend accounting, and route-local execution authorities. Preserve explicit platform/admin services. | Every enabled production skill execution reaches policy snapshot/current capability/spend/answer seams through one executor; every chargeable call uses reservation→attempt→result→settlement; critical spend persistence failure is not ignored; legacy call-site ratchet is zero for production. |
| `COH-08` | 1.5 | COH-02, COH-07 | loop recorder/evidence/policy-output adapter | Replace raw-ish JSON step summaries with semantic event metadata/references. Preserve citations/evidence/artifact/resource refs through privacy protection; store hashes/counts/codes in run events and keep sensitive evidence behind authorized storage. | Seeded tool output containing sensitive fields is absent from generic step history while evidence remains inspectable through authorized refs; policy denial/provider failure/outcome-unknown carry stable codes; event persistence failure has explicit run behavior. |
| `COH-09` | 1.5 | COH-00 | API-server document blob/storage boundary | Harden tenant file lifecycle before CAP/SBX admission: validate company scope on every lifecycle action, derive residency/placement server-side, move blocking filesystem work out of async handlers, preserve opaque object IDs and a replaceable storage backend. | Cross-company lifecycle attacks fail; client residency cannot select policy; no server path is accepted/exposed; async handlers do not perform unbounded blocking FS; incomplete/completed state is explicit and tested. |
| `COH-10` | 1.5 | COH-02 | frontend API client/error boundary + selected routes | Converge frontend/server handling of structured errors/outcomes. Parse the standard envelope once in shared API/client code and migrate the P0/P1 AI pilot surfaces first; components own presentation only. | Pilot UI distinguishes forbidden, stale/conflict, budget/rate, retry-safe, reconciliation-required and internal failures without parsing message text; correlation ID is available for support/operator diagnostics. |
| `COH-11` | 1 | COH-03..10 | compatibility census + CI/source ratchets | Remove accepted obsolete compatibility code and add focused ratchets preventing new production call sites for remaining deprecated seams. Every retained compatibility path gets environment/owner/removal prerequisite. | CI/source checks prevent reintroduction of legacy executor/spend/latest-draft/duplicate permission-map patterns on scoped paths; no retained compatibility fallback lacks an exit gate. |
| `COH-12` | 2x | COH-01..11, BASE-03, BASE-04 | integrated adversarial/E2E proof | Run seam-eradication certification across authorization, company scope, release policy, retries/idempotency, committed-response-lost, spend failures, draft concurrency, structured error mapping and evidence redaction. Fix only defects attributable to this wave; record unrelated blockers. | Integrated stack has one traceable route→context→policy→contract→effect→outcome path; all listed duplicate seams are removed/development-isolated; no hidden critical error/side effect remains; evidence is recorded for coordinator acceptance. |

## 3. Package ownership notes

### COH-01 reserved/likely surfaces

Coordinator decides exact paths after COH-00, but expect overlap around:

```text
ai-gateway/src/routes/*
ai-gateway/src/harness/* context/auth seams
ai-gateway/src/tools/types.rs
Next BFF AI route helpers
```

Do not place service credentials in `TrustedExecutionContext`.

### COH-02 error architecture

Expected implementation direction:

```text
subsystem typed error
   ↓ explicit From/classification
transport error envelope
   ↓
frontend typed API error
```

Do not mechanically replace every `anyhow::Error` in the repository. Migrate boundaries where meaning affects authorization, retry, user recovery, or effect certainty first.

### COH-03 permission migration

Do not preserve privilege implications by copying both maps into a third map. Decide the explicit normalized configuration semantics, migrate/translate legacy seeds/config once, and make runtime evaluation intersection-based.

### COH-04 release policy

`manifest_json`/immutable release representation must be validated rather than trusted blindly. The adapter compatibility check remains useful; policy reconstruction does not.

### COH-05 generated registry migration

A small harness overlay registry is acceptable for policies that do not exist in application IR, such as evidence requirements or model runtime eligibility. It must key by stable generated identities and never restate ERP structural schemas.

### COH-06 exact creation

If STDB cannot directly return reducer results through the current client contract, use the existing request-key mapping pattern. Do not invent “sleep then query newest” or global random-UUID assumptions as correctness.

### COH-07 executor migration

Do not turn `run_recorded_loop` into a god function. Keep loop, provider-spend admission, policy, tools, recorder, and answer gate behind explicit interfaces; the canonical executor composes them.

### COH-08 event persistence

This is not full INTRO. It creates a safe event source that INTRO can later project without first cleaning raw payload logs.

### COH-09 files

Do not implement Daytona/object-storage production infrastructure here. Harden the logical file contract and current local backend so later providers can replace it.

## 4. Parallel execution suggestion

After COH-00:

```text
Coordinator
  integration + reserved wiring + contract lane

Luna A
  COH-01 trusted context

Luna B
  COH-03 capability authority convergence

Luna C
  COH-04 immutable release policy
```

Next batch:

```text
Luna A  COH-02 typed outcomes/errors
Luna B  COH-05 generated contract/scope convergence
Luna C  COH-09 file boundary hardening
```

Then serialize the high-collision integration spine:

```text
COH-06
→ COH-07
→ COH-08 / COH-10 in parallel
→ COH-11
→ COH-12
```

Business defect packages `BASE-03` and `BASE-04` should continue in parallel throughout when ownership is disjoint.

## 5. Relationship to main ledger

Until the main ledger is revised, interpret dependencies as follows:

```text
BASE-00 / BASE-02
        ↓
COH-00..12
        ↓
GOV canonical production activation
        ↓
TRACE / CAP / WPR / SBX / LEARN / INTRO
```

Exceptions:

- known ERP defect remediation (`BASE-03`, `BASE-04`) runs in parallel;
- SEC-00 trusted-envelope work must **converge into COH-01**, not create a sibling execution context;
- low-level governed-loop code already delivered is not blocked from maintenance, but no new production route should be admitted before the relevant COH authority seams are accepted;
- CAP codegen investigation may continue, but production capability expansion waits on COH-05 scope/contract semantics.

## 6. Estimated effort

Planning weight from the current implementation:

```text
COH-00..04   ~6–8 Luna sessions with parallelism
COH-05..10   ~8–11
COH-11..12   ~3

total        ~17–22 focused Luna sessions
```

This is intentionally larger than the earlier 6–8 seam-cleanup estimate because the scope now includes typed outcome/error convergence and the tenant-file boundary rather than only harness duplicate deletion. It should reduce later integration/rework across GOV, WorkPrograms, sandbox and HLEARN.