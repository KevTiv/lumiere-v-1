# Alpha contextual assistant implementation status

Date: 2026-10-28. Initial implementation and backend/module checks used baseline `48aa5912ec007be1996e4561411b9179899ae745`. The PR branch incorporates main through `021aa272160dbbf6b35c46933c097fe1d3ae9630`, retaining its centralized auth, productivity, language settings, and contracts pin. This is local implementation evidence, not a deployed release or completed Alpha admission.

Owning scope: [Alpha contextual ERP assistant and help documents](../plans/alpha-assistant-help-artifacts-plan.md), AIH-29.

## Implemented behavior

- Contextual side chat can open a substantial answer as a Markdown document, including when related saved guides are also available. One bounded closed HTML fence can supply a static HTML derivative.
- The document opens in a modal above the ERP; the ERP form stays mounted. The same viewer supports a dedicated document route, source links, exact revision history, export, editing, and unsaved-change protection.
- Modal and dedicated-page questions use the existing conversation. Questions about saved documents reauthorize the exact revision. Unsaved edits are explicitly quoted as user input, not promoted to verified ERP facts or implicitly saved.
- The dedicated page recovers a known ERP module and valid live-record identity selectors. Current values still come from authorized ERP reads. Stored guide labels, text, and source snapshots do not substitute for current record values.
- KnowledgeArticle owns guide membership and library identity. Typed private guide heads and immutable revisions own company scope, module/workflow, content, revision, and provenance. Public legacy article shells contain no private title or body.
- Save uses the existing session dispatcher with a canonical flat-scalar reducer contract, current company/member/write checks, an actor-bound request key, and exact expected revision. Saved status follows acknowledged identity and readback.
- API search/read/history/save routes are private and non-cacheable. Exact reads check current access around private content delivery, including explicit article-body field restrictions. Generic article edits/publication cannot bypass the revision owner.
- Saved guides appear in the module-filtered library and as exact-revision related references in later chat responses. Chat metadata stores pointers, not cached guide bodies or trusted labels.
- Markdown rejects raw active HTML; HTML uses sanitization, no inline styles or external resources, a restrictive CSP, and a scriptless sandbox. Read and save grant no financial action authority.

## Initial local evidence

| Check | Result and scope |
| --- | --- |
| Shared viewer/chat tests | 22 passed, including HTML/Markdown isolation, failed saves, stale async results, dirty-document questions, and separate generated/related document cards. |
| Browser fixture | 6 passed in system Chromium: ERP draft/focus preservation, same-session modal/full-page continuation, navigation guard, failed-save recovery, HTML isolation, and mobile containment. Saves are an in-memory UI fixture, not backend durability evidence. |
| Visual inspection | Desktop and 390px mobile screenshots inspected. No hydration/page errors observed in the final diagnostic browser. |
| Host helpers | 12 passed: identities, safe navigation, scoped responses, explicit save payload, retry bounds, contextual document questions, and unverified edit input. |
| RAG request references | 3 passed: exact u64 IDs, revision bounds, bounded collections, and rejection of supplied content as identity. |
| Workspace context helpers | 4 passed. |
| Gateway guide retrieval | 6 passed with local HTTP fixtures, including actor authorization, revocation, changed-content races, and exact revision/hash checks. |
| Existing RAG regressions | 22 passed, including existing evidence and action gates. |
| API guide tests | 6 passed in the library target, including current member/field restrictions, source projection, immutable revision labels, and the actual generated-contract HTTP save wire with SATS options and large IDs. |
| Canonical field policy | 1 focused regression passed for explicit body restrictions versus ordinary list defaults. |
| Database guide lifecycle | Passed `run_knowledge_guide_tests` in an isolated local SpacetimeDB 2.8.2 instance: actual save/retry, changed-payload rejection, immutable prior revision, stale expected revision, company isolation, and generic-editor bypass rejection. This is not a restart/persistent-volume acceptance test. |
| Web TypeScript | Passed with an 8 GiB Node heap after correcting the new imports and fixture narrowing. |
| Static checks | Translation keys/duplicate JSON, shared selects, browser operation transport, trusted route boundaries, C2 coverage, operation history, and diff whitespace checks passed. |
| Module compilation | Current module, including generated recovery code, built successfully with the explicit development-test flag and the lower-memory command below. Initial simultaneous builds exceeded workspace memory; they are not counted as passes. |
| Generated contracts | Rust/TypeScript SDK generation completed from the built local module. Canonical IR v2 validates with 1486 operations, 371 resources, 523 tables, and 1417 types. C0/C1 validate all 523 tables; 12 tenant-census regressions passed. Pending migration 0029 adds exactly the two guide tables. No released migration was rewritten. |
| CI registration | Added helper and browser scripts plus required API/field-policy checks to `ci.yml`; the database lifecycle is included in `run_all_platform_tests`. Workflow YAML and package JSON parse. This is registration, not a remote CI run. |

The successful module command was:

```sh
LUMIERE_ENABLE_DEV_REDUCERS=1 CARGO_BUILD_JOBS=1 cargo rustc --locked --offline \
  --profile ci-contracts --target wasm32-unknown-unknown -- \
  -C opt-level=0 -C codegen-units=256
```

This is a development-only test artifact, not a production module. Its SHA-256 is `7ec9ba75e822078a0ddf8d10696422351174c49a7f84d0708d5efff8a9733e3e`. An earlier local artifact lacked the required development admission flag and correctly rejected fixture organization creation; the corrected artifact passed the lifecycle test. The tests did not relax production founder admission.

## PR integration checks

After incorporating main through `021aa272`, the focused viewer/chat suite passed all 22 tests and the Chromium fixture passed all six scenarios. Both Node helper test files passed. A frozen offline install with the pinned pnpm 10.31.0 completed; duplicate JSON, translation-key, locale/interpolation, Kinyarwanda override, and vendored `0.3.157` checks passed. Diff whitespace checks passed and change classification requires every validation lane.

The initial backend/module results above predate the main integration. Hosted CI and regeneration from the integrated source remain required; a draft PR does not establish those results.

## Remaining admission work

1. Review and release matching generated contracts, module, durable schema artifacts, and application revision through the existing release workflow. Main advanced the consumer pin from the initial implementation's `0.3.154` to `0.3.157`; neither release includes these new guide contracts. The initial staging IR is an unreleased candidate. Regenerate from the integrated source and include the new contracts and migration 0029 in a matching release before merge/deployment admission.
2. Exercise authenticated save/reload/new-conversation retrieval against the integrated ERP stack, including denied access, company changes, stale edits, and restart/reconnect. UI fixtures, API wire tests, and direct gateway fixtures do not replace that evidence.
3. All saved revisions currently remain drafts. Independent verification/promotion, source-change invalidation, and a KnowledgeArticle-revision adapter into the existing evidence graph remain separate work. Automatic discovery returns related references; explicit user document questions quote reauthorized text as unverified input. Neither path makes a saved draft independent evidence for generated business facts.
4. Language/workflow/product-version applicability needs a trusted compatibility source and accepted filtering. Returned version metadata alone is not proof of compatibility.
5. A dedicated contextual `Explain this error` control on admitted ERP forms remains to be wired through the existing owner. Contextual chat and existing draft/action-review paths are reused; this slice does not certify every record-entry/recovery journey.

No provider completion, production provisioning, feature merge into main, or deployment is recorded here.
