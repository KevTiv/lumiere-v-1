# COV-05f Purchasing approval controls

**Disposition:** `IMPLEMENTED` — full-stack acceptance deferred by request.

## Delivered controls

- Purchasing delegation creates and revokes the workflow engine's effective-dated
  grants through the existing public Purchasing command. Activation requires an
  explicit start, future end and reason; only the principal or a superuser may
  create a grant. Replacing an active Purchasing delegate requires revocation
  first. Existing metadata-only delegate rows do not acquire authority implicitly.
- Both Purchasing delegation forms collect the validity window. The approval
  panel offers the currently eligible principals by name and passes the selected
  principal to the canonical human-task decision command.
- Inbox reads evaluate active membership, company scope, current roles, role
  expiry, delegation window and revocation. Delegated visibility uses the
  principal's candidate roles/groups/units. A Company A-only actor cannot read
  Company B's workflow records through organization-wide candidate roles.
- Purchasing decisions retain the exact task and workflow revisions reviewed by
  the operator. The wrappers enforce the selected company and do not claim a
  task in a separate call while guessing the resulting revision.
- The Purchasing queue includes Draft/Sent orders named by pending workflow
  tasks, rather than relying solely on the historical `ToApprove` PO state.
- Approval snapshots bind PO supplier/source references, delivery destination,
  payment terms, incoterms, match tolerances and receipt-line identities, plus
  payment references and bank-statement memos. Changed material cannot consume
  the previous approval. Optional references distinguish absent values from
  literal sentinel strings.
- Every AllCandidates approval vote checks the current instance and guarded
  subject before recording a partial vote. Revised subjects can request fresh
  approval with the same domain command key; unchanged requests reuse their task.
- Purchase-order/requisition lifecycle loaders check the caller's active access
  to the stored company. Supplier-intake approval checks company access for
  company-owned vendors.

## Local evidence

- API `workflow_reads::` unit tests: 7 passed.
- Approval-selection tests: 3 passed.
- Delegation window/serialization tests: 2 passed.
- Purchasing configuration tests: 5 passed.
- Human-task effect readback tests: 6 passed.
- Web/query-hooks typechecks and native module compile checks pass. These are
  separate from acceptance.
- Added in-module regression cases for changed PO/payment references, stale task
  preservation followed by fresh approval, delegation revocation and loss of the
  principal's role. These cases have not been executed inside SpacetimeDB.

## Deferred acceptance

Publish to a disposable stack and run `run_workflow_authorization_tests`,
`run_workflow_action_registry_tests`, `run_workflow_human_task_tests`, and the
focused Purchasing tests. Exercise the UI with separate requester, principal,
delegate and reader sessions, including expired/revoked grants, changed
references, concurrent decisions, and two companies in the same organization.
Run COV-05e, COV-05d, COV-21 and the related sales approval regression specs.
Check canonical actor/principal/delegation evidence and absence of domain effects
on rejected decisions. No full-stack acceptance run was performed for this slice.

Pending approvals produced by the old material snapshot may no longer match:
review and request fresh approval rather than weakening the revision check.
The existing Purchasing containment setting still applies to delegation
activation; this change does not enable it automatically. Revocation remains
available when new grants are blocked or the target member is inactive. Delegates
remain subject to the ordinary domain permissions required to execute the
approved action. Direct requisition/intake approval remains independent-person
approval; the new delegation path applies to workflow-backed human tasks.
