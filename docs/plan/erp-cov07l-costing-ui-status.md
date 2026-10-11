# COV-07l actual-cost and configuration UI

Status: UI implementation staged; generated contracts release and integrated runtime acceptance pending.

Initial candidate check: the full web typecheck failed because the
contracts-owned typed-read generator's Accounting-only allowlist omits the four
Manufacturing cost resources from `ResourceQueryRowMap`. The new operation
inputs and general query registry are generated correctly. This needs a
companion emitter change and release/pin; no decoder or generated binding has
been hand-edited to conceal the gap. The approved
[contracts PR #18](https://github.com/KevTiv/lumiere-contracts/pull/18) now provides
the IR-derived codec change, and the full web typecheck passes against its
candidate. Package typecheck/build, 31 emitter tests and 19 runtime tests pass.
The application v0.3.100 pin does not yet contain that unmerged companion fix;
final release/pin and operator acceptance remain pending.

The manufacturing order overview reads immutable `mrp-production-costs` and `mrp-productivity-costs` through generated row decoders. It displays material cost, workcenter cost, total actual cost, output inventory value, variance and configured/unconfigured productivity rates. Missing or withheld amounts show unavailable; an absent close snapshot is explicit. Read denial and failures retain their distinct collection states. Exact MO/organization/company identity owns the snapshot, and duplicate snapshots fail visibly.

Output links use the snapshot's exact output move IDs. A posted valuation links its exact `account_move_id` to Accounting / journal entries. Closed-order refresh invalidates cost and accounting collections together with finished stock.

Workcenter row actions configure an explicit finite, nonnegative hourly rate through `configure_workcenter_cost_rate`; zero is an intentional rate, while a blank rate is rejected. The Costing & Valuation tab reads configured rates and company valuation configuration. Accounting-authorized users configure future valuation posting using active journal and nondeprecated account selections through `configure_manufacturing_valuation`. Both mutations require exact scoped canonical readback before reporting completion. Configuration changes do not rewrite prior cost snapshots.

Required generated release additions (root owns generation/release/pinning): OperationInputMap descriptors for `configure_workcenter_cost_rate` and `configure_manufacturing_valuation`; ResourceQueryRowMap/decoder entries for `mrp-workcenter-cost-rates`, `mrp-productivity-costs`, `mrp-valuation-configs` and `mrp-production-costs`. No generated file is hand-edited by this UI slice.

Verification: seven focused cost-record/configuration/submission tests passed on 2026-10-11, including scope/duplicate handling, unavailable-versus-zero amounts, signed variance, exact large IDs and zero-rate handling. Browser scenarios are authored for rate configuration and closed-order cost/output navigation after reload. Full type checking and runtime acceptance must use the new released contracts and query resources.
