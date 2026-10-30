# Alpha AI skill qualification preparation (AA-06)

Date: 2026-10-30. Base: `3d6f32c23ba4a569f83d752ac0b2257e43799397`.
Branch: `codex/alpha-ai-skill-qualification`. Status: deterministic preparation;
live qualification and current tenant activation remain blocked by missing
authorized tenant/provider access and evaluation budget.

This slice reuses the existing source-bound manifest generator, benchmark
preparer/collector, scenario corpus and certification executor. It adds no
executor, certification authority or release mechanism.

## Six-skill state reconciliation

| Skill | Source-bound candidate at base | Recorded tenant/provider evidence | Current active release |
| --- | --- | --- | --- |
| `report_analysis` | 1.0.7 | [Merged #282](https://github.com/KevTiv/lumiere-v-1/pull/282) records independent 1.0.5 certification and a live Mistral result with persisted trace, independent review and settled spend. This is historical evidence for that release. | Unqueried; neither that historical result nor candidate 1.0.7 establishes current compatibility or activation. |
| `finance_report_review` | 1.0.1 | Source implementation, deterministic replay and proposed manifest; no active tenant certificate established by this inspection. | Unqueried. |
| `bank_reconciliation_review` | 1.0.1 | Source implementation, deterministic replay and proposed manifest; no active tenant certificate established by this inspection. | Unqueried. |
| `period_close_review` | 1.0.1 | Source implementation, deterministic replay and proposed manifest; no active tenant certificate established by this inspection. | Unqueried. |
| `expense_evidence_review` | 1.0.1 | Source implementation, deterministic replay and proposed manifest; no active tenant certificate established by this inspection. | Unqueried. |
| `finance_variance_review` | 1.0.1 | Source implementation, deterministic replay and proposed manifest; no active tenant certificate established by this inspection. | Unqueried. |

Candidate identities come from the [report proposal](../../infra/railway/pilots/report-analysis-certification-manifest.proposed.json)
and [finance proposals](../../infra/skill-releases/finance/).
The [usability status](erp-skills-professional-usability-status.md) supersedes the
older versions in the [finance implementation history](finance-skill-expansion-status.md).
Main pins immutable application contracts 0.3.157; #309 separately owns the
0.3.158 guide contract integration. This slice changes neither pin nor binding.

## Implemented collector behavior

Before this change, a row with `taskSuccess: true` and `correctOutcome: false`
could count as a successful task. Critical failures could also retain a positive
first-pass metric, and per-case success could disagree with group success.
Success now requires the reported success, a correct outcome and no critical
failure. First-pass success requires that same successful outcome without repairs
or fallback. The submitted flag stays visible beside the derived result.

Admitted live outcomes with no provider calls remain valid for denial and budget
tests. Their `live_without_provider` group is separate from `live_provider` and
`fixture_replay`, so a successful authorization rejection cannot inflate model
performance. These are classifications of submitted metrics, not independent
verification of their provenance. Referenced runs, reviews and settled spend
still need examination through their existing owners.

## Local evidence

Executed in this branch, with no tenant or provider calls:

- Eight benchmark unit tests pass, including incorrect outcomes, critical
  failures, first-pass accounting, separate no-provider/live/replay groups,
  failed-attempt spend, forged bindings and invalid metrics.
- The full Python script suite passes: 212 tests, no skips or failures.
- `python3 -B scripts/erp_skill_catalog.py --check` passes.
- `python3 -B scripts/finance-skill-manifests.py --check` passes.
- `git diff --check` passes.

The existing corpus contains 40 pilot and 130 other scenario requirements.
Preparing trials or passing these collector tests does not execute those
scenarios or qualify a provider. No business record was created or changed.

## External acceptance gates

For each proposed release, the runtime owner must read current company-scoped
release/certificate, source binding, permissions, provider profile, policy and
spend limits through canonical authenticated reads. An authorized operator must
then approve an explicit test tenant, exact model profiles and budget before
billable evaluations. Run the existing deterministic/adversarial executor cases,
then the approved real-provider subset, inspect independent usefulness grades,
persisted observations and settled spend, and rehearse disablement/rollback.
Record each gate separately for each skill; a source proposal must not be
advertised as available merely because another release once passed.

Authenticated staging, current release readback, live provider evaluations,
tenant certification/promotion, staged activation, rollback and deployed user
acceptance were not run here. No production setup, release or deployment is
authorized by this preparation PR. Rollback is reverting the offline collector
change; it has no runtime switch or business effect to reverse.
