# COV-00 PR summary

This branch runs the evidence portion of COV-00 against current `main` and records why the package is in REVIEW rather than self-accepted.

## Main findings

- Frontend exposes 31 top-level module route families; Fleet is the main domain/route mismatch and currently operates through `/map` rather than a dedicated `/fleet` route.
- Backend/command breadth is high; the main maturity gap is U2/U3 → U4/U5 product convergence and certification.
- The existing reducer coverage artifact has 1,111 rows, including 972 classified user-facing, 945 `command-only`, 23 `reachable-ui`, and 25 `needs-triage`.
- That artifact predates the accepted v0.3.46 application IR, which validates 1,329 operations, so it cannot close the current-operation acceptance gate.
- No authoritative first-test-org launch/exposure manifest was found; AI/internal/showcase routes must not accidentally enter the T0 denominator.
- No COV-03..24 surface has sufficient evidence for U4/U5 yet; strongest existing surfaces have U3 evidence and should be converged rather than rebuilt.
- Source review found concrete correctness classes that must now remain in the COV denominator: false form success, newest/latest-row effect correlation, error/denied/unavailable reads collapsed to empty data, degraded runtime-form fallback that still permits submission, and stored-dashboard truthfulness/completeness defects.
- Browser lifecycle coverage is not uniformly operator-path proof. HR, Projects, IoT, Proposals and other suites use direct BFF/owner helpers for principal transitions; these remain useful D/A evidence but cannot be counted automatically as O/E evidence.
- Certification helpers that choose newest/highest IDs can hide duplicate or concurrent effects and must not satisfy exact-effect evidence.
- Transport acceptance is not authoritative business disposition. Exact post-read after an ambiguous dispatch proves convergence, but not necessarily whether the invocation applied vs replay/concurrent effect unless the domain/server returns that disposition.
- Remaining COV work is re-baselined to roughly 36–50 focused work packages/sessions, dominated by operator-path convergence, shared semantics, seed/persona proof and certification rather than greenfield backend creation.

## COV-00 closure cards

- COV-00A: regenerate and classify the current operation census.
- COV-00B: create the first-org exposure manifest and settle Fleet `/map` ownership.
- COV-00C: complete the correctness-defect ownership census and attach every defect to its downstream COV-01/UX/module/GOV repair gate.
- COV-00D: calibrate each intended T0 primary lifecycle across `D/A/O/E` — domain invariant, authenticated API integration, actual operator transition, exact effect/recovery.

See `erp-cov00-correctness-evidence-defect-register.md` for the source-level defect register and acceptance additions.

No runtime, schema, authorization, generated contract or product behavior is changed by this branch. Runtime repairs discovered here remain launch/U4/U5 blockers owned by their implementation packages.