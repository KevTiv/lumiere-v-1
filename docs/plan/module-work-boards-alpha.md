# Module work boards for the Finance alpha

## Purpose and scope

The Work workspace is a shared Kanban/list presentation of canonical ERP assignments. It belongs inside a module, with a Finance aggregate and a personal My work entry. Source records, workflow decisions, company access and task attribution remain authoritative in their existing modules.

This change builds on the Finance alpha navigation profile and the shared Kanban renderer. It does not add a second task table, generic lifecycle engine, schema migration or generated operation contract. Operations, workforce and project modules remain subject to their existing discovery and destination gates.

| Workspace | Workflow subjects | Manual record follow-ups |
| --- | --- | --- |
| Purchasing | Purchase orders | Purchase orders |
| Sales | Sales orders | Sales orders |
| Accounting | Accounting entries and payments | Accounting entries |
| Expenses | Expense reports | Not offered: no matching typed Activity target |
| Finance | Union of the four supported workflow modules | Union of the three supported Activity targets |

CRM, Reports and Subscriptions remain visible Finance modules, but this slice does not invent workflow adapters for subjects without a supported canonical source. Project tasks retain their own workspace and assignment command.

## User entry points

- `/tasks` opens My work with the mine filter: workflow tasks claimed by the current actor, or record follow-ups assigned to them. The workspace selector can broaden this to eligible or available work and to a supported module.
- `/purchasing?tab=work`, `/sales?tab=work`, `/accounting?tab=work` and `/expenses?tab=work` open the module's Work workspace.
- `workSource=activities` selects Record follow-ups where supported. Follow-ups are created from the source record's existing activity form.
- `workView=mine|eligible|available`, `workTeam=department:<id>|workflow-group:<id>` and `workLayout=board|list` preserve the selected view in the URL. Activities support department teams; switching work type clears the previous team filter.
- `/tasks?source=projects` retains the project-task workspace. Existing project task filters/tabs and Overview task/deadline links continue to enter that workspace.

Team choices come from authorized loaded cards and current membership/delegation. They are not an organization-wide team directory. Counts explicitly describe loaded records; they are not unrestricted totals.

## Canonical actions

| Source | Board lifecycle | Action and confirmation |
| --- | --- | --- |
| `WorkflowHumanTask` | Open, Claimed, Approved, Completed, Rejected, Invalidated, Cancelled | Existing claim or decision command with company, task revision, workflow revision and exact acting principal |
| `Activity` | Open, Completed | Existing `complete_activity`; preflight and canonical readback retain the same company, module and source record |
| `ProjectTask` | Existing project task states | Existing assignment command; typed identities and exact assignment-set readback, including an intentional clear |

A drag opens the same review panel as clicking a card. It does not optimistically change a card or a business document. The user can open the source record and use the explicit action buttons, including by keyboard. A successful command is followed by canonical readback and a refresh. A failed or ambiguous response keeps an error visible and refreshes the source before another attempt.

Workflow action hints match task kind, assignment policy, claimant, current candidate eligibility, decision grants, separation-of-duties restrictions and unvoted candidate snapshots. Direct and delegated capabilities stay separate. `AllCandidates` decisions can leave a task open after recording a vote; the client follows the returned state. Single-candidate tasks require claim before decision. Rejection comments remain required when the workflow policy says so.

Activities do not acquire approval semantics, exclusive claims or invented reassignment operations. Completion records the follow-up as done. It does not post an accounting entry or confirm an order. Activity completion has no native expected-revision parameter; the UI does not claim an atomic revision guarantee. The native reducer rechecks current source/company access and rejects deleted or already-completed activities.

## Access and data boundaries

The server resolves the authenticated organization and active membership for an explicit company. Every card additionally requires an authorized read of its canonical source in that company. Source titles pass through the existing field projection. Workflow snapshots, guarded-action payloads and decision comments are excluded from the board projection. Activity assignee, deadline and timestamp fields are exposed only when their field policies permit them.

Workflow team filters require current workflow-group/department membership or a valid effective delegation. Activity department filters require current department membership. Team attribution is a filter over the source's existing attribution; it is not a grant of access.

Each board cache key includes organization, company, actor, authorization snapshot, module, view and team. Context changes remount the board and close its review panel. Failed refreshes hide retained records and counts. Offline users can inspect an already-loaded board, but actions stay disabled until online refresh is available; this slice does not queue approvals or completion commands into the offline review pipeline.

Project task assignment uses a dedicated, bounded directory of active organization/company members. General membership queries remain self-only. Create/update/assign reducers validate recipients and actor company access; permitted superuser company bypasses are recorded in the audit event. Clearing an assignment is explicit, and malformed or ineligible existing identities must be cleared before replacement.

## Bounded reads

SpacetimeDB HTTP SQL does not provide an ordered `LIMIT` for these reads. The adapters therefore consume complete numeric-ID windows, sort only complete windows and use bounded existence probes to seek across proven-empty ranges. An arbitrary unordered ID witness is never treated as the lowest ID.

The scanner uses 128-ID windows, at most four complete windows and a shared budget of 64 sparse-seek probes per request. Responses contain at most 50 cards and bound the number of distinct source authorization reads. A cursor carries organization, company, actor and presentation scope. Dense runs of ineligible records can produce an empty page with a continuation cursor; Load more remains available until the cursor is null.

## Validation and release gate

The change includes shared Kanban interaction tests, typed board/assignment model tests, API authorization and pagination tests, and a Playwright fixture that mounts the actual Work components with synthetic HTTP/session boundaries. The fixture covers review before dispatch, exact readback, refusal/staleness, delegated principals, context changes, offline behavior and desktop/mobile containment.

The browser fixture is not a live SpacetimeDB authorization proof. The added project assignment scenarios extend the existing native project test suite. Before alpha acceptance, run those native scenarios and the production browser workflows against the deployed candidate with representative Finance roles, active companies and workflow policies. Include two simultaneous reviewers, membership/delegation revocation, a response lost after commit, and a source record whose status changes while a review panel is open.

The PR records the checks actually executed for its head. The existing Rust CI job also runs the work-board, Activity, assignee-directory and authoritative-source suites. Deployment and live alpha acceptance continue through the existing release gates.
