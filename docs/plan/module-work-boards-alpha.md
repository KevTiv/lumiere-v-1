# Module work boards for the Finance alpha

## Purpose and scope

Kanban is an optional view within the existing module workspace. Each module enables and specializes it through `ModuleConfig.workBoard`; the shared renderer presents canonical ERP assignments as a board or list. The same configuration supports the Finance group scope, and the personal My work entry opens as a list. Source records, workflow decisions, company access and task attribution remain authoritative in their existing modules.

This change builds on the Finance alpha navigation profile and the shared Kanban renderer. Tasks and business lifecycle remain canonical in their existing modules. Explicit recovery adds typed operations and private recovery evidence through the same workflow/contract pipeline. Operations, workforce and project modules remain subject to their existing discovery and destination gates.

| Workspace | Workflow subjects | Manual record follow-ups |
| --- | --- | --- |
| Purchasing | Purchase orders | Purchase orders |
| Sales | Sales orders | Sales orders |
| Accounting | Accounting entries and payments | Accounting entries |
| Expenses | Expense reports | Not offered: no matching typed Activity target |
| Finance | Union of the four supported workflow modules | Union of the three supported Activity targets |

CRM, Reports and Subscriptions remain visible Finance modules, but this slice does not invent workflow adapters for subjects without a supported canonical source. Project tasks retain their own workspace and assignment command.

## User entry points

- `/tasks` opens the personal My work list with the mine filter: workflow tasks claimed by the current actor, or record follow-ups assigned to them. The workspace selector can broaden this to eligible or available work and to a supported module.
- `/purchasing?tab=work`, `/sales?tab=work`, `/accounting?tab=work` and `/expenses?tab=work` select the module's configured **Kanban** tab within its existing page. The tab ID defaults to `work` so existing links remain valid; it does not require a separate Kanban route.
- `workSource=activities` selects Record follow-ups where supported. Follow-ups are created from the source record's existing activity form.
- `workView=mine|eligible|available`, `workTeam=department:<id>|workflow-group:<id>` and `workLayout=board|list` preserve the selected view in the URL. Activities support department teams; switching work type clears the previous team filter.
- `/tasks?source=projects` retains the project-task workspace. Existing project task filters/tabs and Overview task/deadline links continue to enter that workspace.

Team choices come from authorized loaded cards and current membership/delegation. They are not an organization-wide team directory. Counts explicitly describe loaded records; they are not unrestricted totals.

### Module configuration

A module opts in through its existing `ModuleConfig` and renders through `ModuleWorkView`. Without `workBoard`, the ordinary module tabs render on their own. The four Finance module configs enable the view explicitly; source choices match the supported subjects in the table above.

```ts
workBoard: {
  scope: "purchasing",
  tabId: "work",
  label: t("workBoard.kanban"),
  sources: ["workflow", "activities"],
  initialView: "eligible",
  defaultLayout: "board",
  workflowColumnOrder: ["Claimed", "Open"],
  workflowColumnLabels: { Claimed: "Under review" },
}
```

Use `scope: "finance"` when an existing group workspace needs the supported Finance union. `sources: ["workflow"]` narrows a host to approvals; `sources: []` disables its assignment view. `description`, `initialView`, and `defaultLayout` configure the presentation. URL parameters cannot broaden a fixed scope or enable a source excluded by the host. An explicitly selected source that loses permission continues to show denial instead of silently displaying another source.

Column order and labels are presentation options over canonical status IDs. Omitted statuses are appended, including cancelled history, and no configuration changes command authority or introduces new business transitions. Actions still come from the source adapter and current backend authorization. A removed configuration or revoked access unmounts the selected board and its review state, then returns a controlled module to its ordinary tab.

The personal `/tasks` entry preserves existing access and project-task links. Its list/board control is a presentation choice; module Kanban views remain available directly through the module navigation. Additional ERP modules need their canonical assignment adapter and authorization before opting in; this slice does not infer unsupported subjects from a module name.

## Canonical actions

| Source | Board lifecycle | Action and confirmation |
| --- | --- | --- |
| `WorkflowHumanTask` | Open, Claimed, Approved, Completed, Rejected, Invalidated, Cancelled | Existing claim or decision command with company, task revision, workflow revision and exact acting principal |
| `Activity` | Open, Completed | Existing `complete_activity`; preflight and canonical readback retain the same company, module and source record |
| `ProjectTask` | Existing project task states | Existing assignment command; typed identities and exact assignment-set readback, including an intentional clear |

A drag opens the same review panel as clicking a card. It does not optimistically change a card or a business document. The user can open the source record and use the explicit action buttons, including by keyboard. The existing claim/decision hooks accept the board scope and use the common canonical-readback runner. Each confirmed attempt freezes its command key, company, task, reviewed revisions, decision, principal and comment. One command is dispatched; an acknowledged or lost response is followed by an exact, cache-independent read.

The exact read ignores only the mine/available presentation filter, because a successful claim or decision can leave that filter. Organization, company, module, team, current candidate/delegation authority and the actor's source-read/field policy still apply. It joins the actor-owned receipt with its immutable task event by command kind/key/input hash, and checks task, company, actor, principal, prior/result revision, result status and decision. It returns no comments or domain payload. The frontend reproduces the native SHA-256 input hash (length-prefixed UTF-8 fields), including the original workflow revision and normalized comment. A task revision advanced by another reviewer is never proof of this attempt.

If exact proof is unavailable, the board displays an unconfirmed outcome and offers **Check outcome**, which only repeats the read with the original command key/hash and scope. It never redispatches a command to discover whether it committed. A presentation-filter omission or temporary read failure clears the captured source, principal and comment while retaining only this minimal evidence reference. An authorized exact read that no longer exposes the task clears that reference; a context change clears it immediately. Access revoked after commit can prevent confirmation; that does not prove the command failed. Existing approval-inbox callers keep their previous acknowledged-state readback; their broader inbox entitlement is not used for board reconciliation.

Workflow action hints match task kind, assignment policy, claimant, current candidate eligibility, decision grants, separation-of-duties restrictions and unvoted candidate snapshots. Final approval of a guarded action additionally checks the actual actor's known operation permission; the native adapter still performs record-specific inventory, employee and business validation. Direct and delegated capabilities stay separate. `AllCandidates` decisions can leave a task open after recording a vote; the client confirms the exact vote receipt even if another reviewer subsequently advances the task. Single-candidate tasks require claim before decision. Rejection comments remain required when the workflow policy says so.

Activities do not acquire approval semantics, exclusive claims or invented reassignment operations. Completion records the follow-up as done. It does not post an accounting entry or confirm an order. Activity completion has no native expected-revision parameter; the UI does not claim an atomic revision guarantee. The native reducer rechecks current source/company access and rejects deleted or already-completed activities.

## Access and data boundaries

The server resolves the authenticated organization and active membership for an explicit company. Every card additionally requires an authorized read of its canonical source in that company. Source titles pass through the existing field projection. Workflow snapshots, guarded-action payloads and decision comments are excluded from the board projection. Activity assignee, deadline and timestamp fields are exposed only when their field policies permit them.

Native Finance human-task commands independently require the actual actor's current source-read permission through the shared resource/alias/module/deny policy, plus the existing workflow action authorization. A delegate cannot inherit the principal's source-read grant. A decision that executes a guarded business action also retains that adapter's existing permissions and validations under the actual actor. For purchase-order confirmation this includes `purchase_order:write`, plus `stock_picking:create` and `stock_move:create` for stock-bearing lines. Workflow approval authority does not bypass those checks. Non-Finance workflow subjects retain their existing policy.

The additional durable lifecycle coverage in this slice targets purchase-order send/confirm and ordinary payment approvals, including unguarded tasks on those sources. Fresh claims, comments, partial/final decisions, invalidations and cancellations record complete source/effect rows, runtime/task histories, receipts and audits through the existing organization commit pipeline. Receipt replay remains write-free. Bank-linked approvals keep their established settlement persistence path; other Finance board sources retain their existing persistence contracts.

Claim receipt replay now loads and scopes the task, reauthorizes the current actor and principal, and verifies receipt ownership before returning a prior outcome. A valid own replay still precedes stale/Open checks. Decision replay already follows the same ordering. A new decision requires both reviewed task and workflow revisions; concurrent requests cannot overwrite a committed decision. An `AllCandidates` principal must belong to the frozen task electorate **and** still satisfy at least one current candidate role, workflow group or department. Removal does not silently reduce quorum or erase a past vote. New members do not join an already-frozen electorate.

Comment and invalidation commands recheck current authority before both fresh writes and receipt replay. Comments require current candidate, company, source-read and `workflow_task:write` access. Invalidation uses management authority: the actual actor needs current company/source access and `workflow_task:write`, without requiring membership in the reviewer electorate or the separation of duties applied to approval. Its existing requirement for a different observed source revision remains. Both commands accept only the original actor's receipt; an authorized own replay returns without changing task, event, receipt, audit or durable commit evidence. Revoked membership or grants prevent replay as well as a fresh command.

Workflow team filters require current workflow-group/department membership or a valid effective delegation. Activity department filters require current department membership. Team attribution is a filter over the source's existing attribution; it is not a grant of access.

Each board cache key includes organization, company, actor, authorization snapshot, module, view and team. Context changes remount the board and close its review panel. Failed refreshes and successful responses that omit a reviewed row clear the captured row, principal and comment; later recovery cannot reopen the old sheet. Titles and source links render from the current authorized projection, including field redactions. Offline users can inspect an already-loaded board, but actions stay disabled. After browser reconnection or loss/recovery of an established API subscription, the existing `auth-access` query must complete successfully before the exact active board query is refreshed; cached data, missing observers, paused fetches and failed refreshes cannot certify readiness. Fresh HTTP reads can restore readiness while realtime remains unavailable. A socket that never connected, and its repeated failed retries, do not introduce a mandatory realtime dependency. Remounting during an established outage requires fresh HTTP proof again.

Common realtime invalidation aliases now include the organization-scoped board keys and the existing `auth-access` query. Workflow tasks, candidate membership and workflow delegations use the existing API realtime bridge with fixed private table subscriptions, rather than a browser subscription to private data. Polling and focus refresh remain fallback freshness mechanisms; they are not a hard revocation deadline. Native transactional authorization is the mutation boundary, including for an already-open or offline-stale browser.

Project task assignment uses a dedicated, bounded directory of active organization/company members. General membership queries remain self-only. Create/update/assign reducers validate recipients and actor company access; permitted superuser company bypasses are recorded in the audit event. Clearing an assignment is explicit, and malformed or ineligible existing identities must be cleared before replacement.

## Revocation and recovery

Revocation prevents subsequent commands from using removed membership, source-read, candidate scope, decision permission or delegation. A command that commits before revocation remains part of the audit history. Concurrent command/revocation ordering is determined by native transactions, not by which browser notification arrives first.

For an exclusive claim whose actor loses authority, or a required frozen voter who can no longer act, the existing authorized `cancel_workflow` operation cancels Open/Claimed task projections in the same transaction as the instance. It increments their revisions and records task CANCEL audits linked to the existing runtime Cancel event/receipt. Successful earlier tasks, frozen votes, claim ownership history and prior receipts remain intact. Cancellation replay checks current permission and company membership before returning the original result. It does not transfer a claim, manufacture a source revision, or shrink a quorum. Legacy projections from older cancellations use the explicit inventory and repair operation below; replaying the original cancellation has no repair side effects.

| Recovery case | Existing supported behavior |
| --- | --- |
| Bank statement settlement post approval | `resubmit_bank_statement_settlement` accepts an explicit new key/reason, retires the old unposted payment and creates a new linked payment/attempt after the approval is closed. |
| Bank settlement reversal | Existing reversal cancellation permits an explicit new reversal request key. |
| Finance source materially changed | The guarded gate's start/singleton identity includes the real material source hash; a genuine registered-material change can require a fresh task. Cosmetic changes do not. |
| Unchanged purchase-order send/confirm or ordinary payment request | `resubmit_workflow_human_task` creates one new linked approval attempt from the cancelled predecessor, using the ordinary guarded-action gate and current published policy. |

Resubmission requires current workflow creation/task-management permission, actual-actor company/source access and the operation's domain permission. Its reviewed task revision, workflow revision and material source hash must match; the reason and command identity are explicit. The old task remains Cancelled, advances once to record its resubmission event/receipt and retains its claimant, prior votes and history. A unique predecessor link serializes competing resubmissions. A retry by the original actor reauthorizes current access and returns the same result; another actor or changed input cannot reuse that command. The new task starts with its own current electorate and no inherited votes or claim. Ordinary domain requests resolve the linked successor for the same material source, rather than returning the obsolete cancelled attempt. Bank-linked payments continue to use their existing settlement recovery operations.

Recovery outcomes enter the existing organization commit stream with complete task/runtime histories, pinned workflow definitions, audit rows and private recovery evidence. The shared durable projector and reconstruction path consume those full row images. Snapshot collection is bounded to 16,384 rows and fails the native transaction if exceeded; it never drops historical votes or receipts to fit the bound. A successful receipt replay records no additional recovery commit.

Migrating an active guarded approval requires the target HumanTask's single `approved` edge to lead directly to the original action key and schema version. Missing or ambiguous approval paths and changed actions fail both preflight and execution without changing task, token, instance or frozen-vote evidence. A valid migration preserves earlier votes and the historical workflow definitions needed to reconstruct them.

An active or stranded claim must first be cancelled by an authorized workflow operator. Resubmission grants no review authority and executes no purchase or payment effect. An administrator should not alter a source record solely to manufacture a new approval.

### Legacy cancellation inventory and repair

Before alpha acceptance, run the read-only inventory for each intended organization/company using the reviewed database target and its operator credential. The script uses the existing `STDB_HOST`, `STDB_MODULE` and `STDB_SERVER_TOKEN` environment variables; it has no target defaults and never prints the credential. Use the same Node 22+ runtime as CI, with JSON number source context support.

```sh
node scripts/inventory-workflow-cancellations.mjs "$ALPHA_ORGANIZATION_ID" "$ALPHA_COMPANY_ID" > workflow-cancellation-inventory.json
```

Only IDs, scope, version, status and revisions are read. The report keeps u64 identifiers as exact decimal strings and includes the target, capture time, projection digest and affected task/instance revisions. Exit code **0** means clean, **2** means repair is required, and **1** means no complete result could be established. Complete projections are read twice and must match; run against a quiescent scope. Each response is capped at 4 MiB and 10,000 rows. A changing, oversized, malformed or cross-scope response fails closed instead of truncating the result or claiming a clean inventory. The script performs no reducer calls.

If the report identifies stale Open/Claimed tasks under a Cancelled instance, use `repair_cancelled_workflow_tasks` with the reviewed company, instance, expected instance revision, reason, fresh idempotency key and correlation ID. The native operation requires current `workflow_instance:write`, active company access and source-read authorization. It validates every task's source/scope and requires the original cancellation event and receipt. It closes only active task projections through the shared cancellation helper, increments their task revisions and appends a separate repair audit/private receipt linked to the original cancellation. The complete repair outcome and causal history are recorded in one durable organization commit in that transaction. The original runtime revision, cancellation event/receipt, previous task events, claims and frozen votes remain unchanged. A command is bounded to 256 affected tasks; larger anomalies require a separately reviewed repair.

An identical own replay rechecks current authorization and performs no writes. Changed input, another actor's receipt, stale context, a non-cancelled instance or an already-clean fresh command is rejected. Run the inventory again after a repair and retain both reports with the release evidence. A clean initial report requires no repair operation. Deployment acceptance must record whether the inventory was actually executed; adding this script does not certify any database.

## Bounded reads

SpacetimeDB HTTP SQL does not provide an ordered `LIMIT` for these reads. The adapters therefore consume complete numeric-ID windows, sort only complete windows and use bounded existence probes to seek across proven-empty ranges. An arbitrary unordered ID witness is never treated as the lowest ID.

The scanner uses 128-ID windows, at most four complete windows and a shared budget of 64 sparse-seek probes per request. Responses contain at most 50 cards and bound the number of distinct source authorization reads. A cursor carries organization, company, actor and presentation scope. Dense runs of ineligible records can produce an empty page with a continuation cursor; Load more remains available until the cursor is null.

## Validation and release gate

The change includes shared Kanban interaction tests, typed board/assignment/command model tests, API authorization and pagination tests, and a Playwright fixture that mounts the actual Work components with synthetic HTTP/session boundaries. The fixture covers review before dispatch, exact receipt readback, unresolved-outcome reconciliation without another POST, refusal/staleness, delegated principals, omitted/redacted rows, context changes, reconnect authority sequencing and desktop/mobile containment. The existing Frontend CI job runs it through `test:e2e:work-board` with one configured worker and retains failure screenshots and traces. Module-host cases exercise in-page navigation, fixed scope/source configuration, layout/column specialization and removal of an open review after access or configuration changes.

The browser fixture is not a live SpacetimeDB authorization proof. Native workflow tests cover current role/group/department eligibility, frozen quorum, revoked/expired delegation, same-key receipt ownership and replay authorization, source-read policy and cancellation history. They run through the existing workflow domain reducers. Existing project assignment and CRM Activity regression reducers are also included in the standard E2E domain list.

Production E2E specs use the existing account provisioning, independent browser sessions, workflow draft fixture, typed BFF operations and post-commit response-loss helper. Ordinary reviewers receive source read, workflow decisions and the exact operation permissions required by the tested purchase-order adapter; they have no administrator, wildcard or superuser grant. A reader receives no mutation grant. The fixture owner sets up or changes policy; independently authorized observers verify canonical results. The existing E2E workflow selects the new specs; no second pipeline or production staff-account mutation is introduced. Run the acceptance specs with one runner worker against an isolated fixture database; concurrency comes from the independent authenticated sessions inside each case.

Delegations are created/revoked by their authorized principal. Private task evidence uses an independently eligible read-only observer; organization-owner status alone does not grant candidate visibility. The rollback fixture declares the purchase-order gate's condition fields before publishing its workflow and checks the condition snapshot hash before preparing its late-failure scenario. Source-read and organization-membership revocation fixtures are independent, so a failed source case does not suppress the membership proof.

The six live cases cover competing claims and opposite decisions, a lost response after a partial quorum vote commits, source-read revocation, organization-membership revocation, delegation revocation without a direct decision grant, and rollback after a native failure that occurs after attempted vote/domain writes. Revocation cases hold the real browser command while the owner changes authority, then forward the original request and retry its captured body. Independent canonical reads verify that denied commands leave no task, vote, receipt or purchase-order effect.

For local verification on an 8 GiB workspace, run native checks, web typechecking and browser tests sequentially. The full web typecheck exhausted a 4 GiB heap in this workspace; use `NODE_OPTIONS=--max-old-space-size=6144` with the isolated local SpacetimeDB stopped and no other build running. Use `CARGO_BUILD_JOBS=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0` for native checks. A single full module or generated-contract build can still approach the local memory limit; stop it before exhaustion and use the module artifact or contracts release after its shared CI build passes. Missing live services or an unexecuted test must remain explicitly unproven in the PR. The shared CI live suite and the deployed alpha acceptance gate remain distinct from pure/unit/synthetic tests.

The PR records the checks actually executed for its head. The existing Rust CI job also runs the work-board, Activity, assignee-directory and authoritative-source suites. Deployment and live alpha acceptance continue through the existing release gates.

Deployed-alpha acceptance binds the application commit, contract release and module version to the chosen target/company. Use separate agreed ordinary reviewer, reader, principal and delegate accounts with explicit grants. Verify company/team visibility, claim races, partial-quorum outcome readback, source/membership/delegation revocation, recovery and retained audit history through actual sessions. The private inventory credential is used only by the operator for read-only evidence; it is not a reviewer account. The repository's Railway production manifest identifies infrastructure, but does not select or authorize an alpha organization/company or its test identities. A disposable CI fixture run and a deployed-alpha run must remain separately recorded.
