# AIH-31 follow-up anchors evidence (2026-11-18)

## What changed

- api-server `chat_context.rs`: the context envelope is now `schemaVersion: 2` and carries `anchorRefs`,
  the `(entityType, entityId)` pairs from the newest completed assistant turn whose `sourcesJson` is a
  non-empty array. Only `kind: live` / `trust: authoritative` sources with an allowlisted entity type and a
  positive numeric id are kept; the list is deduplicated and capped at 8. No assistant prose, label or
  snippet is added. The "safe assistant excerpt" rule is unchanged, and the stored checkpoint stays at version 1.
- ai-gateway `rag_conversation.rs`: accepts envelope versions 1 and 2 (gateway deploys first). `anchorRefs`
  is parsed defensively (bad entries dropped) and ignored on version 1.
- ai-gateway `harness/follow_up_reference.rs` (new): reference-word table (English, French, conservative
  Kinyarwanda/Swahili; case-folded, diacritic-folded, tokenized), anchor parsing and the apply rules.
- ai-gateway `snapshot.rs`: `resolve_snapshot_candidates_with_anchors` puts anchors after the UI record and
  before every ANN hit. `resolve_snapshot_candidates` is unchanged for existing callers.
- ai-gateway `rag.rs`: anchors go through `filter_entity_refs_by_allowed_types` and then the same
  `fetch_authorized_live_snapshots` read as any candidate; inaccessible ones drop silently. Sources reached
  only through anchors are marked `from_anchor: true`. New request flag `clear_anchors`.
- Web: answer card shows "Using: <record> from your last question" with a clear button; the clear is sent as
  `clear_anchors` until an answer with sources arrives. i18n keys `aiChat.followUp.*` in en, fr, rw, sw
  (rw-x-en is generated and needed no change).

## Rules implemented

Anchors apply when the question names no record and no record is open in the UI, or when it contains a
reference word. A resolved named record always replaces them. A named record that is not found falls back to
anchors only if the question also refers back; otherwise the existing "No matching record" notice is kept.
Priority: UI record, record named in the question, anchors, ANN hits.

## Validated

- Frontend: `pnpm exec vitest run src/lib/follow-up-anchors.test.ts` (packages/ui, 3 passed);
  `pnpm exec tsx --test lib/assistant-turn.test.ts` (web, 27 passed); `pnpm i18n:check` scripts
  (duplicate keys, keys, locales, loanwords) pass. Node 22.23.5.
- `rustfmt --edition 2021 --check` on all changed Rust files.
- Cloud Runner: the gateway suite passed (1,054 passed, 13 ignored), all five API
  chat-context tests passed, and the 30 focused frontend tests passed on Node 26.
  GitHub's Rust and frontend typecheck jobs also passed on `1e9fe7e`.
- The hosted long-thread fixture reached the API but still expected envelope
  version 1. Its assertion now requires version 2 and verifies that ungrounded
  and fresh threads have no anchors. CI and E2E use the shared HTTPS Chromium
  installer to avoid the regional Ubuntu archive that stalled smoke setup.

## Not validated

- The full hosted long-thread run and browser smoke checks have not been revalidated with these fixes.
- Import-card `reviewedRecords` ids are module backfill record ids (sales / shop_sales / warehouse), not ERP
  entity ids with an authorized live-read resource, so they are not anchored.

## Remaining work

- [ ] Confirm the hosted long-thread and browser smoke runs pass on the updated draft.
- [ ] Decide whether to narrow `anchors_apply` for unrelated questions asked right after a record answer.
