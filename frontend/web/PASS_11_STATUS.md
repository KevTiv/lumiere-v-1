# Pass 11: search and consistency

This follow-up is based on `claude/ui-polish-pass-1` at `31bfb557`.
The initial Pass 11 implementation is `6fed95b0`; the PR #151 description was
still listing Pass 11 as planned when this work started.

## Implemented

- The command palette searches 14 record models using existing query hooks and
  the module admission/RBAC gates. Queries begin only while the palette is open
  with at least two characters. This searches the rows loaded by those hooks;
  it is not an exhaustive server-side search.
- Failed model reads now show an error instead of a misleading empty result.
  Failed reads do not expose cached results or stale partner labels, while
  results from healthy models remain usable.
- Browser confirmation calls in the frontend have been replaced by the shared
  AlertDialog hook. It now settles replaced requests, including requests made
  before the next render, and cancels outstanding requests on unmount. It also
  supplies a translated accessible title when callers only give a description.
- Edited FormModal forms ask before dismissal and register a reload/close
  warning. This follow-up also guards ordinary link navigation, replaying the
  original link after confirmation to preserve Next Link handling. In-page
  anchors, downloads and new-tab/modified clicks do not discard the editor.
  A pending navigation prompt is cancelled when the editor becomes clean.
- Form dismissal is blocked while a save is running. A failed save retains the
  draft and its guard; a missing submit binding no longer marks edits as saved.
- Existing state gates and standard actions are retained. Project pages have
  duplicate and archive/unarchive; calendar event pages have duplicate. The
  command requirements and remaining model gaps are recorded in
  `lib/record-standard-actions.ts`.

## Validation (2026-10-07)

- Full UI Vitest suite: 298 tests passed before the final two regression cases;
  final focused run: 28 tests passed across four files.
- UI and web TypeScript checks passed.
- Action-gate and standard-action tests: all five test files passed.
- i18n duplicate/static-key checks and production operation transport check passed.
- The opaque-record ratchet fails on both the unchanged base and this follow-up
  with 2,226 occurrences against the 2,071 baseline; this work does not increase it.

## Remaining acceptance work

- Browser back/forward and imperative router navigation are not intercepted by
  the link guard. Inline editors also need broader navigation protection.
- Archive/duplicate actions requiring new domain commands or child-line copy
  semantics remain documented gaps; they are not implemented as header-only copies.
- Full seeded browser/runtime acceptance has not been run for this follow-up.
  The DOM tests and typechecks do not establish full ERP runtime acceptance.
