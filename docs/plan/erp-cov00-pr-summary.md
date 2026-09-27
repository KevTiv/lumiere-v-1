# COV-00 PR summary

This branch completes the COV-00 evidence package and records coordinator acceptance against integrated evidence revision `4f797db650ae82318ab0f477670d14aee9d5d0cd`.

## Main findings

- Every current module route has one product-surface classification; `/fleet` is the canonical Fleet workspace and `/map` remains a hidden geospatial showcase.
- Backend/command breadth is high; the main maturity gap is U2/U3 → U4/U5 product convergence and certification.
- COV-00A classifies 1,399 canonical operations and reconciles 1,187 Rust reducer rows with zero unowned or review-required client-facing operations.
- COV-00B provides the authoritative first-test-org exposure denominator; all unaccepted COV surfaces remain `review`, while AI/internal/showcase surfaces remain hidden.
- No COV-03..24 surface has sufficient evidence for U4/U5 yet; strongest existing surfaces have U3 evidence and should be converged rather than rebuilt.
- Source review found concrete correctness classes that must now remain in the COV denominator: false form success, newest/latest-row effect correlation, error/denied/unavailable reads collapsed to empty data, degraded runtime-form fallback that still permits submission, and stored-dashboard truthfulness/completeness defects.
- Browser lifecycle coverage is not uniformly operator-path proof. HR, Projects, IoT, Proposals and other suites use direct BFF/owner helpers for principal transitions; these remain useful D/A evidence but cannot be counted automatically as O/E evidence.
- Certification helpers that choose newest/highest IDs can hide duplicate or concurrent effects and must not satisfy exact-effect evidence.
- Transport acceptance is not authoritative business disposition. Exact post-read after an ambiguous dispatch proves convergence, but not necessarily whether the invocation applied vs replay/concurrent effect unless the domain/server returns that disposition.
- Remaining COV work is re-baselined to roughly 36–50 focused work packages/sessions, dominated by operator-path convergence, shared semantics, seed/persona proof and certification rather than greenfield backend creation.

## COV-00 closure cards

- COV-00A: accepted current operation census and classification ratchet.
- COV-00B: accepted first-org exposure authority and Fleet workspace decision.
- COV-00C: accepted correctness-defect census; nine open/partial runtime classes remain downstream blockers.
- COV-00D: accepted per-owner `D/A/O/E` calibration and promotion/admission ratchet.

See [`erp-cov00-coordinator-acceptance.md`](./erp-cov00-coordinator-acceptance.md) for the acceptance decision and validation record.

No runtime, schema, authorization, generated contract or product behavior is changed by this branch. Runtime repairs discovered here remain launch/U4/U5 blockers owned by their implementation packages.
