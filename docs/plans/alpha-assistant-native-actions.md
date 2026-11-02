# Alpha assistant native actions

Baseline: `48bbcfd9a250117816d222df7bd245619ace4b61`, reviewed 2026-11-02.

This track connects contextual ERP chat to existing Alpha destinations, native
forms and governed workflow owners. A proposed action is presentation metadata,
not an authorization grant, a saved business effect or evidence of completion.
Implementation and test evidence below remain separate from hosted acceptance.

## Scope and canonical owners

The current owners are `workspace-profile.ts`, `product-surface-catalog.ts`,
`module-dashboard-configs.ts`, each module's configured form/controller and
its authoritative command/readback path. Reuse their identities and gates.
The ten-module boundary comes from [Alpha navigation](../plan/finance-alpha-navigation-status.md)
and [Products, Warehouse and Fleet](product-fleet-alpha-2026-10-31.md).

| Module | Existing entry and native form identity | Existing owner and required boundary | Representative acceptance journey |
| --- | --- | --- | --- |
| Accounting | `/accounting`; `new-invoice`, `new-bill`, `new-journal-entry` | Invoice/bill authoring and accounting controller; current `account_move:create`, company defaults, valid journal/currency/contact choices, configured creation receipt | Open an exact invoice; prepare its permitted native draft flow; save explicitly and reopen the acknowledged record. |
| Expenses | `/expenses`; `new-expense`, `new-expense-sheet`, `set-expense-allocations` | Expense capture/report controller; `hr_expense:create` or the corresponding report/allocation permission, employee/currency scope and exact saved allocation revision | Open an expense/report; inspect receipt evidence; prepare a supported form and confirm the resulting native state. |
| Reports | `/reports`; `new-financial-report` (`generateReport`) | Native report owner and current source/read/report permissions; explicit run inputs and source basis | Open reporting inputs; run explicitly; reopen the exact output and source links. Native financial reports are distinct from gated AI reusable programs. |
| Sales | `/sales?tab=orders`; `new-sale-order` | Sales quotation/order creation; `sale_order:create`, valid company/contact/pricelist/warehouse choices and configured receipt | Prepare a quotation; review and submit the native form; reopen that order and its permitted next-step handoff. |
| CRM | `/crm`; `new-contact`, `new-lead`, `new-opportunity` | CRM native creation owners; contact/lead/opportunity permission and current reference choices; organization-shared records keep their actual scope | Find a record by exact identity; prepare a contact or opportunity and reopen its saved identity. |
| Purchasing | `/purchasing?tab=orders`; `new-purchase-order` | Purchasing order controller; `purchase_order:create`, authorized supplier/currency/line references and native receipt/bill workflow owners | Prepare and save an order, then reach its exact permitted receipt/bill handoff. |
| Subscriptions | `/subscriptions`; `new-subscription`, `amend-subscription`, `renew-subscription` | Subscription create/amendment/renewal owners; current eligibility, approved request identity and native outcome evidence | Open an existing subscription, inspect recorded lifecycle facts and enter the eligible native workflow. A next-invoice date is not a contractual end date. |
| Products | `/products?tab=products`; `new-product`, `edit-product` | Bounded Inventory catalog projection and existing product owner; `product:create`/write plus authorized category/UOM choices | Search/open a catalog record, prepare its native form and reopen the saved product without inventing price history. |
| Warehouse | `/warehouse`; `new-transfer`, `new-inventory-adjustment`, `new-stock-location`, `new-warehouse`, `new-replenishment-rule` | Bounded Warehouse projection of Inventory owners; each native stock/setup/count permission, quantity/UOM checks and current source state | Reach an exact transfer or observation, prepare the admitted operation and inspect its canonical result. Counts, on-hand, reserved and available quantities stay distinct. |
| Fleet | `/fleet`; `new-fleet-vehicle`, `assign-fleet-driver`, `record-fleet-service`, `record-fleet-inspection` | Existing Fleet controller; vehicle create/write and live scope/lookup readiness, native service-cost posting owner | Register/open a tenant-owned vehicle; enter manual mileage or a garage intervention; inspect exact vehicle/service/accounting references. |

Overview, My work, Approvals, Documents, Calendar and permissioned Settings are
supporting destinations. Existing authorized handoffs into another owner remain
valid. This track does not expose broad Inventory, Manufacturing, HR, Projects,
Helpdesk, IoT, Maps, Messages, Notebook or internal harness screens globally.

Fleet service entry still requires an existing authorized active service type.
`create_fleet_vehicle_service_type` is not admitted by the current browser
operation contract. A prerequisite notice or seeded fixture does not prove
fresh-tenant service-type setup. Immediate Warehouse replenishment execution,
GPS/rental/fuel/TCO/asset-disposal workflows and new project-task ownership are
outside this track's Alpha admission.

## Shared action contract

Use typed semantic capability keys resolved against the existing native owners.
The supported presentation intentions are navigation, exact record inspection,
native form preparation and entry into an existing workflow. The model or a
stored transcript cannot supply an arbitrary URL, form schema, reducer name,
tenant scope or approval grant.

- Resolve exact record IDs losslessly as positive u64 decimal identities.
  Unknown resource types and invalid supplied IDs stay unsupported instead of
  silently landing on an unfiltered list.
- Distinguish “open an order” from “create an order.” Missing or ambiguous
  targets require clarification; unsupported prose can continue through normal
  contextual answers without silently becoming a mutation request.
- Bind prepared form requests to current actor/organization/company scope.
  The destination rechecks its existing readiness and create permission before
  opening a form. A route or context change alone is not permission to submit.
- Reuse native form definitions, custom fields, references, validation and
  submit handlers. Treat assistant text as advisory input. Applying suggestions
  and submitting remain distinct explicit actions.
- Preserve an existing editor, dirty values and its cancel/discard guard. A new
  request cannot replace the editor silently. Keep focus and return navigation
  usable in full and docked chat.
- Native commands retain their existing approval, request identity and
  authorization boundaries. An interrupted response is an uncertain outcome;
  reconcile the same identity before another consequential dispatch.
- Completion follows authoritative exact-result readback. Chat history stores
  references and presentation state; it does not turn an old approval badge into
  current execution authority or current data access.

The reusable-program rules in
[Alpha reusable work](alpha-harness-reusable-work-railway-plan.md) remain in force:
read-only programs may offer existing proposal/review entry points, but cannot
post, pay, move stock, renew or approve by presenting an action.

## Implemented source paths

Both explicit user requests and admitted model replies now use the shared typed
action contract. The bounded request resolver handles clear navigation/form
requests without paying for an unnecessary model turn. For ordinary contextual
answers, the BFF builds permission-filtered offers from its verified session and
the shared catalog; the gateway supplies only those offered keys to the model,
validates returned proposals and releases bounded `ui_actions` metadata through
the existing JSON/SSE response. The host decodes the result, attaches current
scope and revalidates scope/access when the user activates its card. A model
cannot invent a destination URL, reducer call, form schema or persistent grant.

The native form bridge uses existing generic ModuleView forms and custom owners
for invoice/bill authoring, expense entry, subscriptions and report generation.
Captured text opens the existing advisory assistant instead of automatically
changing business fields. Custom invoice/bill editors offer schema-validated
header suggestions only. Their sequence is explicit **Suggest → Apply → native
Submit**; merely opening the editor does not send a paid suggestion request.
Line-item inference and silent field application are not delivered by this
packet. Generic and custom forms retain their own reference choices, validation,
dirty-state protection, configured fields and native submit path.

`prepare_workflow` opens the exact existing record/review owner. It does not
execute the named transition, approve a financial action or create a generic
consequential executor. Existing action-draft execution remains restricted to
its native allowlist and approval owners. The readback path now obtains the
exact draft status/result instead of converting a successful HTTP reply into an
optimistic approved badge.

Preflight and recovery use the existing authoritative resource endpoint,
`/api/authoritative/ai-action-drafts/{id}?companyId=...`, with caching disabled.
The same path supports BFF and direct gateway forwarding. An unavailable or
scope-mismatched read blocks dispatch without falling back to a collection row.

A new native expected-revision/parameter-hash compare-and-swap contract for
approval was **not** added. Presentation revalidation and post-command readback
are not proof that an approval is atomically bound to the exact payload the
reviewer saw while another reviewer edits it. That native-contract/concurrent
review acceptance remains separate and must not be marked complete from these
UI changes.

## Implementation packets

| Packet | Source disposition | Responsibility and required proof |
| --- | --- | --- |
| ANA-01 | Implemented | Exact source/action-result links using canonical record helpers. Two distinct IDs produce distinct destinations; known filters/record pages retain exact identity; malformed and unsafe IDs fail closed. |
| ANA-02 | Implemented | Typed action catalog, decoder, bounded request resolution and model/BFF/gateway `ui_actions` wiring. “Open sale order 42” never prepares a mutation; invoice/vehicle creation resolves to a known native owner; ambiguous/unsupported requests are explicit. |
| ANA-03 | Implemented | Scoped native form bridge and module bindings. Authorized request opens the configured form once; loading/denied scopes do not; a second request retains dirty work; no implicit suggestion generation, application or submit. |
| ANA-04 | Implemented bounded readback/recovery | Approval reads the exact resulting draft; current terminal state/result replace optimistic status; uncertain outcomes offer reconciliation without automatic redispatch. New native approval CAS remains outside this source packet, as described above. |
| ANA-05 | Implemented | Ten-module adapter integration and chat controls. Every enabled catalog action is bound to a configured native owner; unavailable prerequisites stay visible and do not create fake success. This is source coverage, not certification of each module lifecycle. |
| ANA-06 | Local presentation checks passed; hosted gate pending | Production component wiring and browser fixture proof are recorded below. Real signed-in hosted journeys for each enabled capability, server/native effects, current grants, concurrent reviews and final release pins remain required. |

## Acceptance and evidence boundaries

Record source SHA, immutable contract/runtime pins where relevant, exact test
commands/results, actor/company roles and produced record/run/output identities.
Component fixtures can prove presentation ownership and local guard behavior;
mocked query or submit ports do not prove server authorization, native atomicity,
durability or a coherent deployed release.

Required negative cases: denied or not-yet-loaded permissions, unavailable
references, wrong company, changed actor, revoked membership, stale record or
revision, dirty form, cancellation, duplicate clicks, lost replies and delayed
results from a prior scope. Required positive cases include ordinary manual
module creation after the bridge is added, direct record URL/reload/Back,
custom-field preservation and exact result navigation after native confirmation.

No certification, deployment, grant expansion or production business write is
implied by this implementation packet. Hosted acceptance remains outstanding
until its exact candidate and enabled capability evidence are recorded.

## Recorded presentation checks

The local presentation checks below ran in the implementation worktree on
2026-11-02. The integrating PR supplies its immutable tested revision and the
remaining package/backend checks. These results do not replace the ten-module
hosted native-effect acceptance matrix above.

| Check | Result and evidence boundary |
| --- | --- |
| `src/pages/assistant-native-form-module.test.tsx` | **9 passed**. Production provider, ModuleView, RBAC and FormModal/ModularForm with synthetic fields and mocked query/submit ports. Covers explicit opening/submission, permission denial/loading, missing submit owner, unavailable collection, actor/company scope changes, permission loss after opening and preservation of dirty values/discard controls. The combined full-chat-to-docked native form case retains dialog focus and unsent composer text. |
| `src/ai-chat/ai-native-action-card.test.tsx` | Four checks: no execution on render or absent host, one scoped dispatch while opening, bounded error without private details or automatic retry, and suppression of a late prior-scope failure. |
| `src/ai-chat/ai-native-action-panel.test.tsx` | Two mounted production-chat checks: exact action identity beyond JavaScript's safe integer range and composer preservation; no restored-action dispatch without a current host callback. |
| `tests/assistant-native-actions-ui.spec.ts` | **4 passed** in Chromium **153.0.8010.0**, at **390px and 1440px**. Actual browser/Next routing and production chat, action card, scope decoder, form provider, ModuleView, FormModal and navigation guard. Synthetic form fields and a deliberately rejected local submit port; zero `/api/` requests in the positive journeys. |

The browser cases prove chat-to-tab-to-modal opening, keyboard-focusable fields,
dirty-value retention after cancellation and failed save, exact distinct order
links, discard, Back/Forward/reload, viewport containment, denied creation and
rejection of an action captured for another actor/company. Mobile scope controls
are reached by closing and reopening chat, as a user would; no forced clicks or
discard/permission assertion weakening is used.

Commands, from their respective package directories:

```bash
# frontend/packages/ui
node_modules/.bin/vitest run src/pages/assistant-native-form-module.test.tsx src/ai-chat/ai-native-action-card.test.tsx src/ai-chat/ai-native-action-panel.test.tsx --config vitest.config.ts

# frontend/web; use the environment's installed Chromium path when required
LUMIERE_CHROMIUM_PATH=/path/to/chromium node_modules/.bin/playwright test --config playwright.assistant-actions.config.ts
```

The standard Playwright browser download returned truncated archives in this
environment, so the local run used an npm-packaged Chromium executable outside
the repository. Repository dependency pins were unchanged. An initial concurrent
Next/typecheck attempt exhausted the 8 GiB environment before client hydration;
the recorded browser pass ran serially after that contention was removed. This
is browser presentation evidence, not a live tenant, provider, backend authority,
database persistence or release certificate.
