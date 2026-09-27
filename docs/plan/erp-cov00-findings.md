# COV-00 headline findings

1. **Breadth is ahead of product convergence.** Most planned ERP domains already have backend, command/query and route evidence. The dominant work is U2/U3 → U4/U5, not greenfield reducers.
2. **Operation reachability is not a completion metric.** The accepted census classifies all 1,399 canonical operations independently of the smaller set of statically UI-reachable reducer calls. Workflow composition must remain the unit of product evidence rather than creating one button per reducer.
3. **The operation census is current and ratcheted.** COV-00A reconciles 1,399 contract operations and 1,187 Rust reducer rows with zero unowned or review-required client-facing operations.
4. **No audited module qualifies for U4/U5.** Shared outcome/error/readback semantics, first-org seed/personas, cross-module navigation consistency and integrated certification remain open.
5. **Fleet now has one product workspace authority.** `/fleet` is the canonical COV-15 workspace; `/map` is classified separately as a hidden geospatial showcase.
6. **Some browser lifecycle tests prove transport/domain behavior more than operator UX.** Several use direct BFF reducer helpers for principal transitions. They are valuable evidence but cannot substitute for user-reachable lifecycle proof.
7. **The first-test-org denominator is explicit and fail-closed.** The product-surface catalog classifies every route and hides AI, internal, showcase, and unaccepted COV surfaces.
8. **The strongest first convergence lane is O2C/P2P/Finance.** CRM, Sales, Purchasing and Accounting have the deepest existing lifecycle evidence; finish their U4/U5 gaps before rebuilding them.
9. **False success exists in shared UI.** `FormModal` can close and show a success toast even when no submit handler performed a save. This is a launch-blocking correctness class, not merely polish.
10. **Latest/newest-row effect correlation exists in production code.** AI action-draft persistence resolves the highest-id pending draft by reducer after create. Concurrent or replayed requests can be associated with the wrong record.
11. **Read failure can be indistinguishable from valid emptiness.** Client/server `AllowEmpty` helpers return `[]` on non-OK/failure, so denied/unavailable/error can silently render as empty data unless the caller explicitly treats the resource as optional/degraded-safe.
12. **Runtime form fallback can hide dependency failure.** Runtime form configuration can fail, fall back to static config and still allow submission. Critical forms need explicit invalid/degraded behavior instead of silent semantic substitution.
13. **Reporting truthfulness defects are concrete.** Stored dashboard filters can broaden on malformed JSON or unknown operators; missing timestamp/measure/source failure can produce plausible but misleading cards/totals.
14. **Certification helpers can hide duplicates.** Existing workflow helpers/tests sometimes choose highest/newest ids after mutation. A 0..1 business effect must fail on multiple exact matches rather than select one.
15. **Evidence needs four independent dimensions.** COV now distinguishes domain invariant (`D`), authenticated API integration (`A`), actual operator transition (`O`) and exact effect/recovery (`E`). Strong D/A evidence cannot compensate for missing O/E proof.
16. **Transport success is not business effect disposition.** HTTP 2xx / `{ok:true}` means accepted dispatch, not necessarily `Applied`. Likewise, exact effect observed after an ambiguous dispatch proves convergence but not necessarily whether this invocation applied versus replay/concurrent effect unless the domain/server returns that disposition.

See [`erp-cov00-coordinator-acceptance.md`](./erp-cov00-coordinator-acceptance.md) for the accepted evidence revision and scope boundary. COV-00 is `ACCEPTED`; open runtime findings remain assigned downstream blockers rather than audit-package blockers.
