# Alpha report readiness and audit repair

Status: REVIEW. Base `04d8541e4d4cfea61bcf5af4144ab054f33eb878`.
This is source verification, not a deployed or paid-provider acceptance result.

## Readiness path

`ReportAnalysisPanel` reads the session-owned
`POST /api/ai/skills/report-analysis/readiness` route. The BFF accepts only company
and agent intent. Actor, organization and token come from the current session.
It checks company scope, forwards trusted actor headers, and uses the existing
internal gateway authentication. The gateway requires the actor's current
`ai.harness.descriptor.read` capability before reading configuration.

The producer reuses canonical active release/source validation, company skill
configuration, native agent company binding, model policy/review independence,
calibration, decision definition, current-period spend budget and model prices.
It resolves the intelligence policy from the company skill configuration. It
never creates a binding, refreshes a policy snapshot, invokes a provider or
changes a certificate. Responses expose only the selected company/agent,
ready/blocked, a typed blocker code and `billableCalls: 0`.

The form fails closed on unknown, nonzero-cost or foreign-scope replies. It
aborts old reads and checks organization/company/agent identity before enabling
Analyze. Readiness is advisory: it does not reserve request-sized spend or
replace runtime authorization. The submit BFF checks it again before policy
refresh or paid dispatch. A known blocker returns `analysisStarted: false` and
a typed query-hook error. Errors after actual dispatch retain the existing
uncertain-outcome feedback and never auto-resubmit.

The exact browser path requires the edge admission change in the separate edge
packet. No generic path or wildcard grant is added here.

## Settlement finding and repair

A non-healthy independent review correctly leaves a run at `agent_settled`.
Changing that status to completed would weaken the answer gate. No such change
is made.

The concrete source defect was downstream audit feedback:
`run_governed_llm_skill` recorded an artifact, `run completed` and `succeeded`
for every returned run, including review-required, waiting and failed states.
Audit now follows canonical run status. Only completed emits completed; review,
approval, budget parking, failure and unknown states remain distinct. Empty
artifact vectors no longer produce a fabricated artifact audit event.

Report adapter version moves from 1.0.7 to candidate 1.0.8 because source hashes
are immutable within an accepted release. The coordinator must regenerate the
proposed source manifests and development seed from the final combined source.
This does not certify or activate 1.0.8. A stale live release remains blocked
until normal independent certification and promotion succeed.

## Executed checks

- Ten frontend helper, session BFF and submit-BFF tests passed with
  `node --import tsx --test lib/report-readiness.test.ts app/api/ai/skills/report-analysis/readiness/route.test.ts app/api/ai/skills/_governed-llm.test.ts`.
  They cover forged scope, denied actor/company/grant, stale source blocker,
  malformed/foreign/billable replies and blocking before writes/paid dispatch.
- Strict isolated TypeScript checking of `lib/report-readiness.ts` passed.
- Three exact Rust owner-function tests passed in a small cached `rustc --test`
  harness. The harness compiled the current actor-scope helper against the
  existing auth-context crate, native agent binding checks and audit outcome
  classifier. It used a small AppError adapter. This does not compile the full
  gateway. Incompatible cached serde serialization fingerprints were excluded
  from this isolated harness; the full crate still needs normal build checks.
- Rust formatting and `git diff --check` passed.
- Playwright discovered both registered production-panel fixture cases with
  `--config playwright.report-readiness.config.ts --list`. Browser execution
  was not run under the current disk/build constraint. The cases cover stale
  readiness, pre-dispatch stale rejection and a late old-company reply.

## Remaining release and acceptance

Run full gateway compilation and its read-only SQL readiness fixture, full web
and hook type checks, and the two mounted browser cases. The coordinator owns
final proposal hashes and edge integration. No native schema or reducer
signature change is required by this packet.

An exact, independently certified active report release remains a runtime
prerequisite. No grant, budget, provider configuration, live farm record, paid
call, certification or promotion was changed. The prior review-required run is
not proof of fully settled positive completion; that live objective remains
open. Test it only after the matching release and evidence are available.
