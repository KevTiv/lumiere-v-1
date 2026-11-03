# Alpha usability consistency

This change follows the 3 November 2026 authenticated desktop inspection of all
16 sidebar destinations and AI Workbench. The audit found 20 issues. This is the
implementation status, not a claim that the resulting deployment is certified.

## Implemented

| Audit | Result |
| --- | --- |
| UI-01 | Runtime delivery metadata binds to the delivery commitment, not quotation expiry. Canonical fields precede aliases, including disabled/role-filtered source definitions. |
| UI-02 | Contact entity type displays Company/Person in list and detail; missing values remain unknown. |
| UI-03 | History avoids unsupported ORDER BY and unordered sample truncation. Scoped complete ID windows provide newest-first pages, bounded by 128 queries and a shared six-second deadline. Optional economics enrichment has a shared two-second deadline. The UI separates empty, denied, expired, incomplete and unavailable responses and retries the exact failed page. |
| UI-04 | Ready-empty quotation pickers explain setup and offer permission-filtered links in a separate tab, preserving the draft. Refreshed choices reach an already-open quotation. |
| UI-05 | The expense dashboard link that opens receipt capture is named Capture receipt. Operations remains the workspace name. |
| UI-06 | Single-view workspaces omit redundant subtabs. Destination panels remain named; test navigation verifies the visible target panel. |
| UI-07 | Product imports and catalog maintenance are grouped in toolbar menus. Selection actions retain their existing behavior. Menus use the existing permission-filtered action set, confirmation and pending paths. |
| UI-09 | Density controls use styled rounded segments. |
| UI-10 | Legacy empty lists receive the existing permission-gated create action when supported. Empty workflow lists omit orphaned table headers. |
| UI-11 | File cards and tables use readable metadata; a known creation date is explicitly identified when modification time is missing. Upload naming and view names agree. |
| UI-13 | Overview metrics precede work queues and personal widgets. Ready onboarding can be expanded for review. My work explanations are expandable. Dashboard export still captures the visible overview composition. |
| UI-14 | Assistant starter questions reflect module and settings section. They prepare editable drafts and preserve unsent questions; they never send or execute automatically. |
| UI-15 | Form AI uses a compact labelled prompt input. Suggest and Apply remain separate explicit actions. |
| UI-18 | Table-header case no longer changes with sortability. aria-sort belongs to the column header. |
| UI-19 | Global search offers common workflow destinations even when no matching records exist, using admitted and authorized parent surfaces. |
| UI-20 | My work uses the shared page header and module spacing. |

## Bounded improvements and remaining scope

- **UI-08:** shared navigation, density, table and action primitives are improved.
  Consolidating every invoice/entity-list filter toolbar requires a separate
  migration that preserves saved filters, pagination and source completeness.
- **UI-12:** Calendar and Composer explicitly identify the browser timezone;
  Composer's initial date follows that timezone. Financial reporting retains its
  existing UTC semantics. Account-timezone calendar grouping/editing needs one
  coherent conversion change, rather than relabelling browser-local dates.
- **UI-16:** operational approval wording is simplified. Technical evidence and
  lifecycle inspectors keep their identifiers and diagnostics. A broader
  inspector information architecture is still to be designed.
- **UI-17:** product/vehicle submit labels, quotation date labels, document views
  and upload labels are aligned. This is not a complete application copy rewrite.
- These changes do not certify mobile layouts, alternate themes, full language
  packs, populated financial workflows or every role-specific state.

## Authority and state boundaries

Presentation components do not grant access or own business state. Existing
server authorization and reducer validation remain authoritative. Setup links
require the destination module read permission and the resource create
permission. Unavailable/denied lookup reads are not represented as missing setup.
Workflow suggestions inherit the same admitted parent surfaces as navigation.
History queries and their returned rows are checked against exact organization,
company and integer ID bounds. A deadline is not reported as empty history.

Current main already admits the exact history read endpoint through Kong. No
gateway admission or permission expansion is included here. Live history failure
causality still requires checking the deployed version and runtime responses.

## Validation

Locally available checks:

- Native Node helper/config checks for form alias precedence, enabled-field
  visibility, ready-empty setup, document projection/date formatting, Assistant
  starters, empty-state permissions and workflow navigation.
- Existing run-history parser tests and document-projection tests through native
  TypeScript stripping with temporary external import resolution.
- All five Kong private-release routing tests.
- Translation-key, duplicate-key, locale/core-coverage and generated Kinyarwanda
  loanword checks.
- Changed plain TypeScript syntax and diff whitespace checks.

Mounted React regressions cover form recovery/draft retention, CRM semantic type,
Assistant context/drafts, explicit AI suggestion application, grouped actions,
navigation singleton behavior, table sorting semantics, document metadata and
history retry/denial. Rust reader tests cover unordered/sparse IDs, pagination,
query budgets and deadlines/cancellation. These require hosted CI: the cloud
workspace has neither usable frontend dependencies nor a Rust toolchain.

After CI, verify the exact deployed commit in an authenticated session at normal
desktop width, docked Assistant width and supported mobile widths. Rehearse a
quotation with missing setup, populated record lists, source import review and
history pagination without performing irreversible business operations.
