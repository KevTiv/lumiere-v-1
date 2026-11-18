# Harness and chat remediation — 2026-11-17

## Observed production failures

- Evidence review queue requests at 11:42 and 12:04 UTC failed because
  SpacetimeDB rejected `ORDER BY id DESC LIMIT 26`. The gateway returned 500;
  the API returned 503.
- Chat messages associated with runs 4098, 4099, 4100, 4102 and 4104 contained
  the withheld notice `structured answer must identify at least one material
  claim`. Runs 4100, 4102 and 4104 were nevertheless recorded as completed.
- The latest observed chat request at 15:03:56 UTC reported zero company hits,
  organization hits, live snapshots and returned sources.
- Startup reported Qdrant client 1.17.0 against server 1.12.6. This warning did
  not establish the cause of empty retrieval.

No private message bodies, credentials or raw model candidates are retained here.

## Changes

1. Review queue reads use supported SQL and the same bounded ID-window selection
   algorithm as chat history. A full unordered sample is never sorted and
   misrepresented as the newest page. Payloads are fetched only for selected
   IDs. The organization/company/status predicate is preserved on every query.
   The queue has a ten-second deadline inside the API's fifteen-second forward.
2. RAG's generation provider now uses a single typed `submit_rag_answer`
   submission with one to six claims and explicit support references. Missing,
   ambiguous and malformed submissions fail without a retry. The normal answer
   gate still checks coverage, authorized evidence, semantic support and
   release-time access; shape validation is not publication approval.
3. Earlier conversation text alone no longer enables generation without
   evidence support. Empty healthy retrieval returns deterministic guidance to
   select a permitted record, spreadsheet selection or saved import and specify
   the financial reporting period. Unavailable retrieval remains explicitly
   unavailable. Authorized history references remain usable for discussing
   saved conversation evidence, not establishing current ERP facts.
4. Initial gate rejections now record failed runs, not completed withheld prose.
   Completion logs contain run ID, run status and verification outcome, not
   business content. JSON/SSE verification survives the web parser and is saved
   with the chat message; blocked/requires-review messages have failed status.
   Saved browser metadata is not independent review or evidence authority.
5. Compose and the assistant-history CI service use Qdrant 1.17.0, matching the
   existing health image. The Rust dependency is constrained to the 1.17 patch
   series rather than accepting an arbitrary future minor.

## Validation

Run with `CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0`:

- `cargo test -p ai-gateway --bin gateway --locked --no-default-features`:
  **1,034 passed, 13 ignored, zero failed**.
- `cargo test -p stdb-client --locked`:
  **21 unit tests and 2 integration tests passed**.
- The former source-manifest check passed at this stage; it has since been
  removed with the unnecessary built-in certification maintenance workflow.
- `rustfmt --edition 2021 --config skip_children=true --check` on changed gateway
  and client Rust implementations: passed.
- `git diff --check`: passed.

Frontend:

- `tsx --test frontend/web/lib/assistant-turn.test.ts
  frontend/web/lib/assistant-history.test.ts`: **30 passed**.
- These tests used Node 25.2.1, `npx`-provided tsx/TypeScript and a temporary
  tsconfig mapping workspace imports to checked-in package source. Node 26 is
  the declared project runtime; the exact installed-workspace/Node-26 command
  was not run.
- TypeScript transpilation reported no syntax errors in the modified shell,
  answer parser and tests. This is not a full frontend typecheck.

The checked-in contracts archive was checksum/provenance verified and unpacked
for Cargo. No generated bindings were manually edited.

## Rollout and limits

- This work does not deploy, promote certificates, change credentials, alter
  production storage or repair historical completed/withheld rows.
- Repository-owned skills and harness changes ship with the application.
  They do not require certification or activation, and code changes do not
  require skill-version bumps or refreshed source manifests. Only user-created
  skills go through the saved version/test/publish lifecycle. See
  [skill ownership and lifecycle](../plan/skill-ownership-and-lifecycle.md).
- Do not point the new Qdrant image directly at an unreviewed 1.12 volume.
  Back up storage, follow staged upstream minor upgrades, verify collections,
  embedding dimensions/model identity and retrieval before admitting traffic.
  The live Railway image remains unchanged by this patch.
- This is not an automatic company-wide accounting analyst. The chat still
  needs authorized evidence for a specified scope/period. Empty retrieval now
  asks for that context instead of spending generation tokens on unsupported
  prose. Existing report/finance workflows remain the owners of aggregate reads.
- No fresh live model call, browser E2E run, full frontend typecheck, Docker
  stack validation or live Qdrant upgrade was performed. Before rollout,
  verify a grounded Accounting request through the real operator path, inspect
  its verdict/run/spend, verify the queue, and test denied/revoked evidence.
