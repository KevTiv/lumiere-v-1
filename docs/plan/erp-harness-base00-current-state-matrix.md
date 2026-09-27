# BASE-00 current-state matrix

**Status:** ACCEPTED EVIDENCE — 2026-09-14
**Program:** [`erp-harness-implementation-coordination-plan.md`](./erp-harness-implementation-coordination-plan.md)
**Reviewer:** coordinator session
**Method:** remote inspection of open PRs, CI results, pinned manifests, and targeted source greps at the stack tips. No local build, seeded run, or browser workflow was executed — BASE-00 is inventory and validation only.

## 1. Chosen implementation base revision

**Accepted base: `78b3c2637`** — head of `codex/contracts-v0.3.46-pin` (PR #37), pinning `lumiere-contracts` **v0.3.46** (revision `a2d7f618`).

Why this revision:

- It is the last revision where the full pinned-contract validation is green. CI at this revision ran `check-codegen-pinned` clean: contract IR v2 valid (1329 operations, 336 resources, 471 tables, 1270 types), agent capability artifact valid (**3 reviewed entries**), staging populated from the pinned contracts checkout, plus frontend, Playwright compile smoke, i18n, and SpacetimeDB checks.
- The chain tip above it, PR #45 (`codex/ai-harness-role-capability-grants`, 4 commits, +3422/−1950 over 31 files), is **not accepted**: its `Rust` CI job fails at `check-operation-history-pinned` — `latest history revision does not bind the recorded operation baseline`. The branch pins `lumiere-contracts` v0.3.47 (revision `26618dec`) and hand-edits `lumiere-codegen/contract-operation-history.json` / `contract-operation-ids.json` without completing the producer → release → consumer cycle. This violates the coordination plan's release protocol (§10); repair belongs on the #45 branch through the release lane.

## 2. Open-PR reconciliation

The harness implementation stack is one linear chain; the top branch contains every ancestor commit.

| PRs (in order) | Branch path | Content | Disposition |
| --- | --- | --- | --- |
| #13 | `codex/frontend-ir-foundation` → main | frontend IR foundation, authorized collection/detail preview | contained by #25 chain |
| #14–#16 | plan-ledger / tool-calling / coordination | harness delivery docs + typed LLM tool transport | contained |
| #17–#18 | capability-ir / capability-publish | governed capability codegen + registry transfer | contained |
| #20 | capability-pin | first agent capability release pin | contained |
| #21–#22 | h3-coordination / h3-adapter | H3 verified catalog + authorized tool view | contained |
| #23 | h4-loop | bounded agent loop + event persistence | contained |
| #24 | h5-policy | H5 per-call policy + approval stops | contained |
| #26 | h5-persistence | H5 budget + draft persistence foundation | contained |
| #28–#31 | h5b-release / contracts-v0.3.44-integration / h5b-gateway | H5b spend + draft-request contracts (pin v0.3.44), gateway spend/draft primitives | contained; #29/#30 share one head branch (double-PR anomaly) |
| #32 | contracts-v0.3.45 | run wait states, provider attempts, presentation contracts (pin v0.3.45) | contained |
| #33 | h5c-provider-attempts | provider attempts + run wait states wiring | contained |
| #34 | aih22-non-progress | stop the governed loop on non-progress | contained |
| #35–#36 | capability-allowlist / review-entries | propose + accept the first reviewed capability entries | contained |
| **#37** | `codex/contracts-v0.3.46-pin` | **pin release v0.3.46 — accepted chain tip** | **landed via PR #47** |
| #45 | `codex/ai-harness-role-capability-grants` → main | role-scoped capability grants (STDB `ai/capability_grants.rs` + tests, api-server routes, orchestrator/spend admission) + contracts v0.3.47 attempt | **open, Rust CI red** — repair operation-history binding via release lane, then merge; the only remaining harness-chain PR |
| #19–#25 | `codex/frontend-ir-saved-drafts` / `codex/frontend-ir-save-reopen` | presentation IR canonical personal draft snapshots + save/reopen (13 commits total) | **landed via PR #48** (conflict reconciliation + integration fixes on the branch) |
| #27 | `test/pre-tenant-adversarial-certification` → main | pre-tenant adversarial suite: Playwright specs (agent, communications, IR, payments, mobile) + Rust `pretenant` certs (payments, communications, money, state machine) | **merged (PR #27)** |
| #1, #2 | copilot WIP / vibe plan | unrelated | out of program scope |

## 3. Package matrix (delivered / partial / missing)

Evidence keys: **[CI]** = green CI job at the cited revision; **[src]** = code verified by targeted grep at the tip; **[plan]** = planning docs only.

### BASE

| ID | State | Evidence |
| --- | --- | --- |
| `BASE-00` | **delivered by this matrix** | this document; base revision chosen above |
| `BASE-01` | partial | base revision chosen; consolidation PR not yet merged [CI at #37] |
| `BASE-02` | partial | [CI] `check-codegen-pinned` + verify scripts green at v0.3.46; must re-run on integrated `main` |
| `BASE-03` | missing | communication defects still open; adversarial specs exist on #27 [src] |
| `BASE-04` | missing | payment/import/recovery defects still open; `pretenant-money.rs`/`payments_cert.rs` exist on #27 [src] |
| `BASE-05` | partial | `@pretenant` suite written and green on #27 branch [CI], not yet run against a seeded integrated `main` stack |

### GOV — canonical governed execution

| ID | State | Evidence |
| --- | --- | --- |
| `GOV-00` | partial | `run_recorded_loop` + durable run in `ai-gateway/src/orchestrator/{run,agent_loop}.rs` [src]; non-progress stop in `orchestrator/progress.rs` [src]; no production route verified reaching it |
| `GOV-01` | partial | authorized generated-tool view in `ai-gateway/src/tools/generated{,_read}.rs` [src]; role-scoped grants in #45 extend this (blocked by drift) |
| `GOV-02` | partial | spend reservation/attempt/settlement + `outcome_unknown` in `ai_spend.rs`, `orchestrator/spend_admission.rs`, `spacetimedb/src/ai/spend.rs` [src]; reconciliation path not audited |
| `GOV-03` | partial | `ai-gateway/src/harness/action_draft_bridge.rs` exists [src]; exact run/request correlation not audited |
| `GOV-04` | missing | no candidate-answer admission seam found at the tips in this pass |
| `GOV-05` | missing | legacy fence not implemented; `governed_llm_skills.rs` exists but route classification census not run (COH-00) |
| `GOV-06` | missing | pilot E2E not run |

### TRACE / CAP

| ID | State | Evidence |
| --- | --- | --- |
| `TRACE-00..07` | missing | no source/claim/lineage/question/continuation code found at the tips in this pass |
| `CAP-00` | partial | generated capability artifact v2 + registry v1 with 3 reviewed entries [CI at v0.3.46]; codegen `--agent-capabilities-only` + verify scripts [CI]; expansion beyond first entries not done |
| `CAP-01..05` | missing | — |

### ERP / ADV

| ID | State | Evidence |
| --- | --- | --- |
| `ERP-00` | partial | ADV helper fixtures exist on #27 (`state_machine_cert.rs`, `money.rs`) [src]; shared workflow/action/result seam not implemented |
| `ERP-01..07` | missing | vertical certification not started; known communication/payment defects are blockers |

### WPR / SBX / SEC / LEARN / INTRO / ADVAI / ML

All rows **missing** — no code found at the tips in this pass; the plans for these families are docs-only (#38–#43 chain, now merged to `main`).

### COH

`COH-00..12` **missing**. The duplicate generations enumerated in coordination plan §3 are live, and PR #45's hand-edited operation history is itself an instance of the unreleased-contract seam COH exists to eradicate.

### COV / UX

| ID | State | Evidence |
| --- | --- | --- |
| `COV-00` | missing | module/operation parity census not run |
| UX-00 evidence | partial | presentation-IR personal drafts save/reopen delivered on #25 chain at `7b676cb00` [src], green [CI]; shared component/config reconciliation (UX-00) not run |

## 4. Known defects carried into execution

1. **#45 contracts drift (active, chain tip):** `check-operation-history-pinned` fails; v0.3.47 pin hand-edited without a release. Repair through the release lane on the #45 branch.
2. **Communication blockers** (BASE-03): tenant reference crossing, consent/identity recheck, immutable approved content, separation of duties, stale provider callback, number-change behavior.
3. **Payment/import/recovery blockers** (BASE-04): payment post/reversal retry semantics, conflicting idempotency-key replay, money boundary handling, statement CSV/idempotency.
4. **PR #25 chain vs harness chain overlap:** both touch `frontend/packages/*` and generated-contract consumers; the merge order in §5 controls this. Resolved in PR #48 (integration fixes `ff17a293e`/`adb8157a8`).
5. **Pre-tenant E2E on integrated main (run 34889586620): 190 passed / 11 failed / 19 skipped.** Ten failures are the suite's deliberate `capability-pending` guards — the capabilities became available when #47/#48 landed but their adversarial certifications are not yet written (AG-07, AG-08 agent loop; IR-01/IR-02×5/IR-03 presentation IR; M-04 mobile). One is a real defect: **PAY-06-E2E** overpayment allocation produces a NaN `writeOffAmount` — a BASE-04 payment-semantics defect, not an integration regression.

## 5. BASE-01 consolidation order (proposed; executed 2026-09-14)

Reuse the existing PR branches; each chain lands on `main` through its top branch (the top branch carries all ancestor commits):

1. **Harness chain:** PR `codex/contracts-v0.3.46-pin` → `main`. Lands H3/H4/H5/H5b/H5c/non-progress + reviewed capability pin v0.3.46 in one merge, matching BASE-01's gate *"through the first reviewed capability pin"*. Ancestor PRs (#13–#24, #26–#38) auto-supersede.
2. **Pre-tenant suite:** merge #27 → `main` (green, 2 commits).
3. **Frontend IR chain:** PR `codex/frontend-ir-save-reopen` → `main` after step 1; resolve generated-frontend overlap on that branch, not in `main`.
4. **#45 stays open:** its drift repair (regenerate operation history, publish v0.3.47 properly) becomes the first release-lane package; merge only after the repair is green.
5. Then run **BASE-02** validation on integrated `main`.

One release lane at a time; no merging into intermediate branches.

## 6. Execution record — 2026-09-14

BASE-01 and BASE-02 were executed as written in §5:

| Step | PR | Result |
| --- | --- | --- |
| Harness chain → `main` | #47 (`codex/contracts-v0.3.46-pin`) | merged; 100 files; contracts **v0.3.46** now authoritative on `main` |
| Pre-tenant suite | #27 (`test/pre-tenant-adversarial-certification`) | merged (was draft) |
| Frontend IR chain | #48 (`codex/frontend-ir-save-reopen`) | merged after on-branch reconciliation: kept v0.3.46 pins/manifest/Cargo authority and the Makefile-owned generator; preserved saved-draft decoder/schema; dropped stale v0.3.43-era generated files; fixed the saved-draft pin fixture (derives from `account_moves_capability`), regenerated `Cargo.lock` (+`spacetimedb-sats`), fixed the opaque-record ratchet in `preview-composer.tsx` |
| #45 role-scoped grants | #45 | **open** — first release-lane package (operation-history rebind, proper v0.3.47 publish) |

Validation on integrated `main` (`a088500cd`):

- CI run 34889586554 **success**: `check-codegen-pinned` (IR v2 valid, capability artifact, operation history), Contracts drift (schema/release + storage policy), Rust suite, Frontend, SpacetimeDB check, Playwright compile smoke, PDF regression.
- i18n / params-cohesion / semantic-index Q0 all success.
- E2E smoke (run 34889586620) **failed as designed against unfinished certification**: 190 passed / 11 failed (10 `capability-pending` guards + 1 real PAY-06 payment defect) / 19 skipped. See §4 item 5. This is the BASE-05 frontier, not a BASE-02 regression.

Ledger updates: `BASE-01` → ACCEPTED, `BASE-02` → ACCEPTED (contracts version **v0.3.46**), `BASE-05` remains open with recorded evidence.
