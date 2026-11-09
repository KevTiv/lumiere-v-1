# Alpha UX completion

This work builds on the alpha interface cohesion changes from PR #388. That PR
was merged into the Documents branch after #387 was squash-merged into `main`.
The integration starts from `main` and applies the exact #388 tree delta; the
Documents base and `main` have identical trees. Existing generated contracts,
permissions, upload recovery, native commands, and saved layouts retain their
owners.

## Implementation lanes

| Lane                      | User outcome                                                                                           | Acceptance                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation and handoffs   | An exception queue opens the records it counts; an order opens its own approval.                       | Shared selection predicates, visible filters, correct company and record identity; independently loaded receipt and bill sections remain usable.                                         |
| First saved outcome       | Getting Started opens the native form and confirms the saved record.                                   | Cancel/failure never complete a task; authoritative scoped readback, reload, return navigation, permissions, and draft retention remain intact.                                          |
| Daily work                | Role-relevant follow-ups, billing, and scheduled work are discoverable together.                       | Existing authoritative readers and permission gates; no duplicate work state, no implied approval, truthful bounded counts and exact destinations.                                       |
| Import completion         | Destination support is visible before review, and results explain created records and unresolved work. | Existing previews, source decisions, approval, execution and posting remain distinct; correction uses the native record owner; saved receipt lookup remains actor/company/request bound. |
| Reconciliation exceptions | Partial, currency, and difference cases explain the appropriate next step.                             | Exact settlement validation is unchanged; authorized native handoffs retain evidence and do not claim to close a bank line.                                                              |
| Office previews           | Authorized Excel and DOCX versions can be inspected inside the shared viewer.                          | Bounded server-side parsing, exact version/checksum authorization, sheet selection, literal content, no macro/formula execution or external fetches.                                     |

## Boundaries

This is an extension of the existing finance-alpha surfaces, not admission of
additional ERP modules. UI links do not grant authority or own business effects.
Office viewing does not widen import or AI ingestion permissions. Existing native
accounting owners remain responsible for payment, exchange, write-off and posting
semantics. Production storage migration and tenant business writes are separate.

The broader historical-import roadmap includes additional native destination
adapters, cross-file reconciliation, cancellation and supersession. Source review
and UI guidance must not label an unsupported destination as executable or imply
that changing source decisions rewrites previously created ERP records.

## Verification

Local verification completed:

- Full web TypeScript check passed with no diagnostics.
- Focused model/component tests passed for navigation and partial loads (33),
  activation (48), daily work (4), import/recovery (54), reconciliation (33), and
  Office/file preview behavior (29). Office parser regression tests passed (19),
  including multi-sheet, malformed/unsafe archives and UTF-8 byte limits.
- Vendored frontend/Rust contract pins, release manifest, authorization registry,
  storage policy, browser operation IDs/transport, dashboard scope, shared select,
  type-debt, i18n and lifecycle/seed evidence checks passed. The opaque-record
  baseline decreased by four; no new generic row debt was admitted.
- Changed Rust files pass formatting. Playwright specs collect successfully and
  the new daily-work spec is included in the existing work-board CI suite.

Local checks used Node 24.22.1; CI owns the repository's Node 26 runtime, full
builds and Cargo/native integration suites. Chromium could not launch in the
managed local sandbox (socket/ptrace permission errors), so browser behavior is
not claimed as locally verified. Hosted browser suites and deployed acceptance
remain required; source coverage and synthetic fixtures are not production proof.

The deployed acceptance pass should use a real authorized test company and a
restricted role: open an exception, complete a first task, revisit its exact saved
record, recover a partial load, review an import result, inspect a workbook, and
return without losing context. Include keyboard operation, narrow viewports,
long values, and interruption. Do not perform irreversible production actions
merely to establish UI acceptance.
