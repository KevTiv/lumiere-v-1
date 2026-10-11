# COV-07j resulting-record navigation

Status: implemented; integrated browser runtime acceptance pending.

Row action submission retains the existing canonical resolved outcomes for record output, close, finished-output scrap and BOM byproduct definition. The dialog reports those outcomes to the manufacturing client before closing. Rejected, denied and unresolved mutations continue to show the submission error and never create a success link.

The manufacturing order record page also retains its lifecycle command results and uses the same resulting-record banner. Existing state-gated header actions remain authoritative; this adds navigation after successful canonical resolution. Result banners clear when organization, company or record context changes. Implementation base: PR175, contracts v0.3.99.

The resulting-record banner links only exact verified IDs through the standard `moduleTabHref` contract (`tab` plus `filter=id:<id>`):

| Resolved record | Read surface |
| --- | --- |
| Manufacturing order | Manufacturing / orders |
| BOM byproduct definition | Manufacturing / bom-byproducts |
| Finished or scrap stock move | Inventory / stock-moves |
| Finished destination quant | Inventory / stock |

The new BOM byproducts entity tab uses the existing canonical `mrp-bom-byproducts` query and displays read denial/errors through `ModuleView` collection state. It does not replace a denied read with an empty list. Completion exposes every finished move from its validated MO-owned output relation, including byproducts, together with the primary destination quant.

Focused tests cover exact destinations, large u64 identities, unsupported references, untrusted href rejection, complete output identity retention, and mutation error propagation. COV-07f/g browser assertions click the operator result links, verify one exact row on the correct tab, and repeat that readback after reload. The shared integrated acceptance lane must run these assertions before treating this navigation slice as runtime-proven.

Verification on 2026-10-11: `node --import tsx --test lib/manufacturing-result-links.test.ts lib/manufacturing-row-action-submit.test.ts` in `frontend/web` passed all six navigation/submission tests; `node --import tsx --test src/hooks/manufacturing-production-close.test.ts` in `frontend/packages/query-hooks` passed all six completion readback tests. `git diff --check` passed. Browser assertions are authored but require the shared runtime lane.

Scope: this closes the discarded result-reference gap. Manufacturing stock valuation, tracked outputs, in-production scrap, routing and full lifecycle acceptance are separate COV-07 slices.
