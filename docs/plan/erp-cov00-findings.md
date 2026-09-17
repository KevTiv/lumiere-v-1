# COV-00 headline findings

1. **Breadth is ahead of product convergence.** Most planned ERP domains already have backend, command/query and route evidence. The dominant work is U2/U3 → U4/U5, not greenfield reducers.
2. **Operation reachability is not currently a trustworthy completion metric.** The older coverage artifact reports 972 user-facing reducers, 945 command-only and only 23 directly reachable UI rows. Workflow composition must classify these rather than create one button per reducer.
3. **The operation census is stale against the accepted contract baseline.** The reducer artifact contains 1,111 rows while the accepted v0.3.46 application IR validates 1,329 operations.
4. **No audited module qualifies for U4/U5.** Shared outcome/error/readback semantics, first-org seed/personas, cross-module navigation consistency and integrated certification remain open.
5. **Fleet is structurally inconsistent.** Fleet domain/contracts/hooks exist, but its operator workspace is `/map`; COV-15 needs one canonical product owner/route.
6. **Some browser lifecycle tests prove transport/domain behavior more than operator UX.** Several use direct BFF reducer helpers for principal transitions. They are valuable evidence but cannot substitute for user-reachable lifecycle proof.
7. **The first-test-org denominator is not explicit.** AI, forensics, presentation-preview and trackers exist in the route tree without one authoritative launch/exposure manifest.
8. **The strongest first convergence lane is O2C/P2P/Finance.** CRM, Sales, Purchasing and Accounting have the deepest existing lifecycle evidence; finish their U4/U5 gaps before rebuilding them.
9. **False success exists in shared UI.** `FormModal` can close and show a success toast even when no submit handler performed a save. This is a launch-blocking correctness class, not merely polish.
10. **Latest/newest-row effect correlation exists in production code.** AI action-draft persistence resolves the highest-id pending draft by reducer after create. Concurrent or replayed requests can be associated with the wrong record.
11. **Read failure can be indistinguishable from valid emptiness.** Client/server `AllowEmpty` helpers return `[]` on non-OK/failure, so denied/unavailable/error can silently render as empty data unless the caller explicitly treats the resource as optional/degraded-safe.
12. **Runtime form fallback can hide dependency failure.** Runtime form configuration can fail, fall back to static config and still allow submission. Critical forms need explicit invalid/degraded behavior instead of silent semantic substitution.
13. **Reporting truthfulness defects are concrete.** Stored dashboard filters can broaden on malformed JSON or unknown operators; missing timestamp/measure/source failure can produce plausible but misleading cards/totals.
14. **Certification helpers can hide duplicates.** Existing workflow helpers/tests sometimes choose highest/newest ids after mutation. A 0..1 business effect must fail on multiple exact matches rather than select one.
15. **Evidence needs four independent dimensions.** COV now distinguishes domain invariant (`D`), authenticated API integration (`A`), actual operator transition (`O`) and exact effect/recovery (`E`). Strong D/A evidence cannot compensate for missing O/E proof.
16. **Transport success is not business effect disposition.** HTTP 2xx / `{ok:true}` means accepted dispatch, not necessarily `Applied`. Likewise, exact effect observed after an ambiguous dispatch proves convergence but not necessarily whether this invocation applied versus replay/concurrent effect unless the domain/server returns that disposition.

See [`erp-cov00-correctness-evidence-defect-register.md`](./erp-cov00-correctness-evidence-defect-register.md) for ownership and acceptance requirements. COV-00 remains `REVIEW` until COV-00A operation census, COV-00B exposure manifest, COV-00C correctness-defect ownership and COV-00D D/A/O/E evidence calibration are complete.
