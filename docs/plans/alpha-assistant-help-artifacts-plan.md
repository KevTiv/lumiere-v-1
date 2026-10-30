# Alpha contextual ERP assistant and help documents

Date: 2026-10-28. Target: Alpha. Status: core implementation and local checks complete; matching contract release and integrated Alpha admission remain pending. Verified-guide promotion and full compatibility filtering remain later work. See the [implementation status](../plan/alpha-assistant-help-artifacts-status.md).

## User outcome

A user works in the ERP with chat at the side, asks about the current record or workflow, and receives a grounded explanation and a useful next action. Generated documents open in a modal above the ERP layout or in a dedicated in-app view. Saved guides belong to their module and can be found and cited in later conversations. Returning to a guide must not depend on keeping the original chat open.

The user's chosen direction is Dia-style contextual interaction. The primary goal is successful ERP use: recording business information, understanding records, recovering from errors, and continuing across related workflows. A generated document supports that task; it is not required for every answer.

This is the Alpha scope addition tracked as AIH-29 in the [harness issues](./ai-harness-completion-issues.md) and linked from the [Alpha UX sweep](./alpha-paid-user-ux-sweep.md). It extends the existing assistant and Documents/Knowledge surfaces. It does not admit new financial actions or change the existing Mistral pilot's release gates.

## References inspected

Mobbin web previews were inspected on 2026-10-28. They establish visible interface patterns, not the products' storage, authorization, or retrieval behavior.

| Reference | Observed pattern | Alpha application |
| --- | --- | --- |
| [Dropbox Dash edit/preview modal](https://mobbin.com/screens/7842cb89-6808-47cf-a8f1-54e84470ad09) | A large modal overlays the application, with a document preview and a chat-to-edit area. | Primary structural reference for opening a generated document over the ERP and continuing the same conversation. |
| [Docusign document preview modal](https://mobbin.com/screens/e625762f-ee03-4a68-8853-4b1aadb6470f) | Document preview overlays an in-progress workflow with a clear close action. | Closing the preview returns to the same ERP task. This is a document-preview reference, not an agent-harness example. |
| [Mistral AI document canvas](https://mobbin.com/screens/dc92d05f-dbb6-4151-89ec-d9bacd44c0da) | A document card in the conversation appears beside a larger document, with copy, expand, and download controls. | Reference for a document card and dedicated document workspace; it does not override the user's modal-first choice. |
| [Intercom knowledge contents](https://mobbin.com/screens/7275c2fb-b226-47b1-a550-5ef33437a171) | Folders and articles share a searchable contents table with type and availability columns. The inspected interface is in German. | Reuse Documents/Knowledge organization and make each guide's scope and availability visible. |
| [ElevenLabs knowledge base](https://mobbin.com/screens/67e87818-fd79-43a6-a0e3-cc6d795f7478) | Search, folders, file/text/URL creation, creator, and last-updated information appear together. | Show where a guide belongs, its source, and its update date in the existing library. |
| [Dropbox Dash cited answer](https://mobbin.com/screens/fc54be30-29ff-430c-9554-7858c47373e8) | Answer bullets have source references, followed by suggested questions. | Preserve citations in the short answer and the full guide; offer follow-up questions near the guide. |

Other agent interfaces were checked against their own documentation, separately from Mobbin:

- [Devin release notes, October 26 and 23, 2026](https://docs.devin.ai/release-notes/overview): HTML artifacts can appear inline in messages; rendered HTML elements can be quoted with a note. Apply an inline guide card in Alpha. Element selection and visual annotation can follow later.
- [Devin Skills](https://docs.devin.ai/product-guides/skills): descriptions support discovery and relevant procedures can be invoked automatically. Its [Knowledge documentation](https://docs.devin.ai/product-guides/knowledge) now marks Knowledge deprecated in favor of Skills in Plugins. Borrow relevant-context discovery; do not copy a deprecated feature or turn ERP help articles into executable instructions.
- [Dia conversations, context, and chat](https://www.diabrowser.com/release-notes/1-6-0-conversations-context-chat): visible tab read/open/close activity and automatic memory search. Its [link-opening update](https://www.diabrowser.com/release-notes/1-10-1-year-end-release) preserves the current page when opening a chat link. Apply explicit context labels and preserve the user's ERP page when opening help.
- [Claude artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them): documents open beside a conversation and can be revisited and edited. Apply a stable document identity across follow-up edits.

Use Lumière's Quiet Precision tokens, typography, themes, and shared controls. Reference screenshots supply interaction structure, not a replacement visual system. Module filing, verification states, and version rules below are Lumière product decisions.

## Baseline examined before implementation

Source inspected at `48aa5912ec007be1996e4561411b9179899ae745`. These baseline observations explain the original gaps; the [implementation status](../plan/alpha-assistant-help-artifacts-status.md) records subsequent code and local evidence. Neither establishes deployed acceptance.

| Owner | Existing seam | Missing for this feature |
| --- | --- | --- |
| Assistant host | `frontend/web/app/(modules)/modules-shell.tsx`: `ErpAiChatPanel` derives route/module/company/selection context and reads/writes chat sessions and messages. | Durable guide references in messages, save/open behavior, and restoring an open guide. |
| Shared chat UI | `frontend/packages/ui/src/ai-chat/ai-chat-panel.tsx`: full/docked presentation, sources, actions, and run links. Message bodies currently render as preformatted text. | A structured guide card, readable Markdown pane, and narrow-screen transitions. |
| Message contract | `frontend/packages/ui/src/lib/ai-chat-types.ts`: message/source/action types. | A versioned artifact-reference projection that survives persistence and reload; a `filePath` or callback alone is insufficient. |
| Gateway output | `ai-gateway/src/tools/save_artifact.rs`: output gating and a returned title/kind/content/run ID. The source explicitly calls the tool return-only. | A durable document/version identity and confirmed storage result. Its name is not evidence that a document was saved. |
| Knowledge | `spacetimedb/src/documents/knowledge.rs` and `frontend/web/app/(modules)/documents/documents-client.tsx`: articles, categories, editing, membership, locking, and publication controls. | Validated module/workflow associations, guide provenance, revision semantics, and assistant handoff. Recheck current company/member enforcement before reuse. |
| Managed files | [Document storage/access](./document-storage-access.md): document/version metadata, authenticated blob routes, immutable bytes, and storage configuration. | Archive/export integration for help artifacts and evidence against the selected deployed backend. |
| Retrieval | `frontend/web/app/api/ai/context/document/route.ts` and `api/ai/_lib/indexing-gates.ts`: document indexing returns a deferred 503. | Accepted ingestion, access/revocation propagation, and source-version-aware retrieval. Do not claim automatic reuse from a saved file alone. |

## Ground the interaction in ERP work

The task loop is: current ERP context -> authorized records -> explanation or prepared draft -> review -> existing ERP action -> visible saved result. A relevant document can be opened or saved at any point in that loop.

- Show a readable context label such as `Accounting / Vendor bill VB-1042 / Current company`. The user can explicitly choose another permitted record or workspace. Route/selection context is a hint; server authorization determines the data available to the answer.
- Use canonical ERP read capabilities for current values and related records. Use saved guides for procedures. A saved explanation of an old balance is historical evidence, not the current balance.
- Cite concrete records, fields or calculations, and snapshot time where relevant. Distinguish current record facts, saved company policy, general guidance, and unresolved inference in plain language. Link each source to its authorized in-app record or exact document revision.
- If a required field or record is missing, ask a focused question or open the existing lookup/editor. Do not invent a customer, account, currency, permission, or business fact to complete the story.
- Support record entry as well as error explanation: prepare a permitted draft using the existing form/action-draft flow, show the proposed values and missing choices, and take the user to review it. Preserve user-entered values. Reuse the operation owner rather than creating a second form or directly executing generated code.
- Cross-module continuations use exact record relations: for example, an invoice can lead to its customer or related payment workflow when admitted and permitted. Retain the origin, selected record, filters, and return route. Opening a document is optional.
- Show what actually happened after a confirmed action, including a link to the saved record. Failed or uncertain dispatch remains a recovery state; it must not become a success message or a duplicate retry.
- When the underlying record changes, mark an open explanation's snapshot as older and offer refresh. Do not silently rewrite a saved guide or overwrite unsaved form values.

## Alpha interaction and document hosts

Keep the ERP page and side chat as the normal working layout. Selecting a generated document card opens a bounded, accessible modal above that layout. Include title, module, save state, close, and `Open full page`; use one scrollable document body and reachable actions. Keep the ERP editor and chat mounted so closing returns to the same values, selection, scroll position, and conversation.

A true modal traps focus and makes the underlying ERP and docked chat inert. Provide an `Ask about this document` composer inside the modal, attached to the same session and document revision, so users can continue without starting a second chat. The full document workspace uses that same session too. Never leave apparently usable controls behind an overlay.

`Open full page` opens the same document/revision in a dedicated view inside Documents with a clear `Back to task` action. Proposed guide route: `/documents/knowledge/[id]`, with an explicit revision parameter for cited history; this route is not implemented by this plan. Both hosts reuse one document viewer and reference model. On small screens use a full-screen dialog or dedicated page, not an extra column. Route changes must follow the existing unsaved-work guard.

```text
Normal: [ERP page / current record] [Contextual side chat]

Open document:
+---------------------------------------------------------------+
| Same ERP page and chat preserved beneath the modal             |
|   +-------------------------------------------------------+   |
|   | Guide title · Accounting     Open full page · Close    |   |
|   | Module / workflow · Draft / Saved / Needs review       |   |
|   |                                                       |   |
|   | Explanation, record references, checks, and next steps |   |
|   |                                                       |   |
|   | Ask about this document       Save · History · Export |   |
|   +-------------------------------------------------------+   |
+---------------------------------------------------------------+
```

1. Start from the existing assistant, or a contextual `Explain this error` entry on an admitted Alpha workflow. Supply a bounded error code/message and current context; do not silently attach an entire record or arbitrary console logs.
2. Show the effective module and company. Search only authorized, applicable guides. If retrieval is unavailable, say so and keep the ordinary permitted answer path available.
3. Give a short answer with sources. Offer a guide for a substantial explanation or on request. A one-line answer does not need a new document.
4. Open the guide in the modal without navigating away from the ERP task. A retrieved guide opens at its cited version; a new guide opens as an unsaved draft. `Open full page` preserves the guide, revision, same conversation, and return context.
5. `Save guide` shows the proposed module/workflow, visibility, and title. Reuse the current category when appropriate; allow a permitted correction. Show `Saved` only after durable acknowledgment and a reloadable identity. A later edit has an explicit save/update action in Alpha.
6. `Explain step 2` uses the open guide ID/version and bounded selected text. Updating a saved guide creates a revision. The prior revision and source references remain available.
7. The user finds it again in Documents/Knowledge and from a `Guides` entry for the relevant module. A new chat cites the existing guide when applicable, rather than generating a duplicate by default.

An illustrative vendor-bill posting error is a demonstration scenario, not an assertion that the particular cause is a closed period. Diagnose from authorized evidence; preserve uncertainty when evidence is missing.

## Content, filing, and storage

- Canonical guide content is Markdown owned by the existing KnowledgeArticle domain. HELP-01 adds an explicit revision contract there if current operations do not retain immutable revisions. HTML and DMS exports are read-only derivatives pinned to that revision; do not maintain independent editable article and file copies.
- Reuse existing category hierarchy for module/workflow browsing. Category names are navigation labels, not access-control boundaries. One stable guide may have several validated module associations.
- The durable model/projection must carry guide ID and revision, title, module/workflow keys, document type, language, applicable product/workflow version, organization/company applicability, visibility, author, originating run/message, sources, timestamps, and review state. These are requirements, not claims that all fields exist today. Extend canonical contracts where needed; do not hide authority in free-text metadata.
- Distinguish an incident note, a reusable troubleshooting guide, and a company procedure. An incident's customer details should not flow into a broadly reusable guide. Company-specific guidance retains its actual company restriction.
- Reuse existing article/category operations and document/version storage. Large exports and HTML bytes follow the managed blob lifecycle. Temporary sandbox files, browser local storage, and chat history are not the durable library.
- New generated guides are drafts. Saving does not certify correctness or publish to a wider audience. Reuse existing publication/member controls, and map `Verified`, `Needs review`, and `Superseded` to an explicit server-owned lifecycle before using those labels.
- A verified revision stays immutable. Changes produce a draft revision and retain the prior verified revision until a permitted replacement is verified. Changed sources or superseded workflow versions make affected guidance visibly require review.

## Harness and client contract

Extend the existing generated capability and message contracts. Do not add a parallel set of hand-written ERP tool schemas or bypass output/evidence gates.

The required operations are: search permitted guides, read an exact guide revision, prepare a draft, persist a guide revision, and open a persisted reference. Resolve these onto existing canonical operations first. Register a new capability only where the current owner lacks the operation.

An artifact reference needs a stable ID, revision, format, module/workflow, title, originating run/message, and confirmed persistence state. The server produces authorized references and permitted actions. The client resolves canonical identities into in-app routes; it does not execute model-authored JavaScript, trust a supplied filesystem path, or accept arbitrary URLs as saved identity. An unsaved preview is explicitly a draft, with no fabricated persisted ID.

Message persistence and hydration must preserve these references through streaming, refresh, reopening a conversation, and switching full/docked views. Opening is a client view action, not a model-controlled arbitrary page launch. Hosts without the viewer receive an authenticated link to the same saved revision.

Saving and updating require current document-write authority and run policy. ERP postings, approvals, payments, and setup changes remain separate governed actions. Reading a help document does not authorize executing its instructions.

## Retrieval and rendering requirements

Filter by organization, current company applicability, effective access, language, review state, and workflow compatibility before ranking. Reauthorize before retrieving content and before returning citations, including when cached results are used. Show the source revision and freshness in the guide. Allow users to attach an authorized guide explicitly to a chat.

Do not substitute a different company's guide when no applicable result exists. Do not treat failed retrieval as zero results. A revoked or deleted guide must disappear from search and stop returning protected content through saved links, cached passages, previews, and future chat hydration.

Markdown uses a reviewed renderer with raw HTML disabled and safe link handling. HTML previews use an isolated sandbox with scripts, forms, top navigation, same-origin access, and network loading disabled for Alpha. An unavailable or unsupported HTML preview falls back to the Markdown view or an authorized download. Generated rich content has no access to session credentials or ERP actions.

## Delivery packets

| Packet | Owning surface | Deliverable and dependency |
| --- | --- | --- |
| HELP-01 | Knowledge + generated contracts | Extend the KnowledgeArticle owner with scoped immutable revisions, module associations, review lifecycle, and stable reference contract. Document schema/contract gaps explicitly. |
| HELP-02 | Gateway + Documents | Connect admitted output to actual guide/version persistence. Add idempotent create/update identity, conflict handling, and truthful save results. Depends on HELP-01. |
| HELP-03 | Shared UI + assistant host | Side-chat guide card, shared Markdown/HTML viewer in modal and dedicated page, same-session follow-ups, save/update feedback, module filing, history, return context, and persisted-message hydration. Depends on HELP-01/02. |
| HELP-04 | Retrieval + evidence owner | Authorized indexing and version-aware search/read/citation with revocation propagation. Depends on HELP-01/02 and existing document/RAG acceptance prerequisites. |
| HELP-05 | Alpha integration | Contextual explanation and record-entry/recovery handoffs, module Guides entry, integrated acceptance, accessibility, and exact-release evidence. Depends on HELP-03/04. Reuse existing ERP read/write and action-review owners. |

Sequence packets through the existing ownership process. The user authorized sub-agent implementation after this plan was prepared. The [implementation status](../plan/alpha-assistant-help-artifacts-status.md) records the resulting work and its evidence; the requirements here do not themselves establish completion.

## Alpha acceptance

The [implementation status](../plan/alpha-assistant-help-artifacts-status.md) records local results and remaining checks for these cases. Opening/saving and future-chat reuse have separate acceptance results; full feature completion requires both.

| Case | Required evidence |
| --- | --- |
| Grounded record question | A question about a selected record cites actual permitted ERP values and their snapshot. Missing or conflicting facts stay explicit; a historical guide is not presented as a live record. |
| Record entry and continuation | Prepare an admitted record draft, retain entered values, review through the existing owner, confirm the actual saved result, and follow a permitted related-record link with the original return context intact. |
| Error to guide | An admitted Accounting error produces a bounded contextual answer and opens its guide in a modal above the ERP without losing the current form or chat. |
| Modal to dedicated view | Open full page and return to the task with the same guide revision, conversation, record, filters, and draft values. Modal close restores focus to its opener; follow-ups use the existing session. |
| Save and reopen | Save under the intended module/workflow, refresh, close the original chat, and reopen through Documents/Knowledge and the module entry with the same guide/revision. |
| Future chat reuse | A new authorized conversation asks the same question, retrieves the saved applicable guide, and cites its exact revision. Assert the selected source; answer similarity alone is insufficient. |
| Update and concurrency | Follow-up changes create a revision; history remains readable. A stale edit conflicts rather than silently overwriting. Repeated save or lost acknowledgment does not create duplicate guides. |
| Scope and revocation | Cross-company, unauthorized member, revoked access, deleted source, and company-switch cases return no protected content, including through restored messages and caches. |
| Truthful state | Denied write, unavailable storage, failed indexing, absent retrieval, and interrupted generation remain distinct. An unsaved preview is never labelled saved or verified. |
| Compatibility | Changed source or workflow version marks affected guidance for review; no silent use of a superseded revision as current. |
| Changed live record | Alter a source record after generating the explanation; its older snapshot is visible and refresh reads current authorized data without overwriting the user's unsaved work. |
| Safe presentation | Markdown and HTML payload fixtures cannot run scripts, submit forms, load remote resources, or navigate the ERP. Citation links remain usable. |
| Responsive continuity | Desktop and 390px-wide operation, keyboard focus/return, screen-reader labels, light/dark themes, and full/docked transitions retain the conversation and guide selection. |
| Business actions | Reading, saving, downloading, or citing a guide produces no financial mutation or implicit approval. |

Use focused component/contract tests for persistence states and rendering, and an end-to-end seeded scenario for save/reload/new-chat retrieval and revocation. Record the application revision, contract version, backend, roles/company, test result, and remaining blockers. No test execution or deployed behavior is claimed by this plan.

## Alpha boundary

Include contextual side chat grounded in ERP reads, draft/review handoffs through existing ERP owners, modal and dedicated-page document hosts, Markdown reading, isolated static HTML preview, module filing, durable revisions, explicit save/update, reopening, and authorized future-chat retrieval. Visual HTML annotation, collaborative cursors, arbitrary interactive apps, public publishing, executing saved procedures, and learning executable skills from a guide are later scope.

The Alpha feature remains pending until its integrated acceptance passes. The existing [Mistral coordination record](../plan/mistral-alpha-coordination-2026-10-23.md) separately records document/RAG dependencies; a successful viewer demonstration cannot close those gates.
