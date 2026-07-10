# Operational Messaging Plan

## Scope

Add phone-first operational communication for customers and suppliers. Version
one supports WhatsApp/SMS copy actions and internal notes; it does not promise
direct delivery or marketing automation. Later provider integration is an
adapter behind the same message lifecycle.

## Current Codebase References

- `spacetimedb/src/core/messaging.rs`: polymorphic `MailMessage` and
  `MailFollower`; `post_message`, `post_internal_note`, subscription reducers.
- `spacetimedb/src/documents/templates.rs`: `MailTemplate`,
  `create_mail_template`, `queue_mail_from_template`.
- `spacetimedb/src/integrations/whatsapp_business.rs`: secure WhatsApp Business
  account configuration and audit, but not provider message delivery.
- `frontend/packages/query-hooks/src/hooks/messages.ts`,
  `frontend/web/app/(modules)/messages/messages-client.tsx`, and
  `frontend/packages/ui/src/crm-components/crm-record-timeline.ts`: current
  hook, workspace, and timeline patterns.
- `frontend/web/app/api/mail/dispatch-queued/route.ts` and
  `api-server/src/routes/mail.rs`: existing queued-mail integration boundary.

## 1. Current Codebase Evidence

Internal comments/notes and record followers are implemented and audited, and
mail templates can queue email messages. WhatsApp configuration keeps credential
references out of the database. No durable outbound operational message entity
exists; a mail row cannot represent copy-to-WhatsApp/SMS intent, recipient phone,
template variables, consent, preview, approval, delivery status, or a bulk batch.

## 2. Proposed Architecture

Keep `MailMessage` for internal chatter. Add an operational messaging submodule
whose records link to `Contact` and a polymorphic ERP subject:

```txt
MessageTemplate -> approved, localized template and variable schema
OperationalMessage -> draft/copied/queued/sent/failed/cancelled record
MessageRecipient -> normalized phone/channel/consent snapshot
MessageBatch -> bulk preview and approval envelope
MessageDeliveryAttempt -> later provider adapter outcome and evidence
ContactCommunicationPreference -> channel, consent, quiet hours, opt-out
```

For v1, `OperationalMessage.status = copied` records that staff used a controlled
copy action. It must not falsely claim WhatsApp/SMS delivery. The timeline is a
read model combining existing `MailMessage`, `OperationalMessage`, sales orders,
purchase orders, account moves/payments, and internal notes in reverse time.

## 3. Backend Changes

1. Add `spacetimedb/src/core/operational_messaging.rs` (or an integrations-owned
   module if the team wants adapter ownership) with tables/reducers and explicit
   organization/company/polymorphic subject indexes.
2. Add template keys for payment reminder, receipt, invoice reminder, order
   confirmed, goods ready, supplier purchase request, stock arrival, and customer
   balance reminder. Templates define allowed variables, locale, active/review
   state, channel applicability, and retention classification. Render from typed
   subject data server-side; reject unknown variables.
3. Add contact communication preferences and phone identity snapshots. Do not
   overwrite historical recipient data when a contact phone later changes.
4. Add reducers to create a single message draft, preview a batch, approve/reject
   a batch, record a copy event, queue a direct-provider attempt, and append
   delivery status. Require selected template and linked source for customer or
   supplier messaging; free-form messages require a stricter permission.
5. Add a timeline query/read-model service scoped by organization/company and
   subject type/ID. It should return typed events rather than asking the frontend
   to join every table. Limit results and cursor-paginate.
6. Later, implement WhatsApp Business/SMS adapters in `api-server`/a worker.
   They receive only a message ID, resolve a secret reference server-side, obey
   template/opt-out/rate limits, and append delivery attempts. Never give the AI
   provider credentials or direct network access.

## 4. Frontend Changes

1. Extend CRM contact detail with `Timeline`, `Messages`, `Balances`, and
   `Activity` tabs. Reuse `crm-record-timeline.ts` presentation but source it
   from the new typed timeline endpoint.
2. Add compose panels to customer/supplier, sale order, purchase order, invoice,
   payment, and stock-receipt views. Default to a template, show resolved fields,
   masked phone, consent state, and a deliberate `Copy WhatsApp` or `Copy SMS`
   icon action with platform-aware clipboard feedback.
3. Update `messages-client.tsx`, `messages-entity-configs.ts`,
   `messages-form-configs.ts`, and `hooks/messages.ts` with list filters,
   template management, notes, delivery/copy state, and batch approval screens.
   Use shared form configuration rather than ad-hoc compose payloads.
4. Build bulk reminder selection from unpaid balances. It must show recipient
   count, excluded/no-consent contacts, template preview samples, and source
   invoices before submit; no bulk copy/send control is active until approved.

## 5. AI/Harness Changes

AI may summarize a timeline and draft a personalized template only as amber
output. It returns a structured message draft with recipient count, variables,
masked phone, exclusions, and source records. Bulk messaging is red: it requires
the batch preview, a permitted human approver, audit, and a cancellation window.
Direct provider delivery remains outside sandboxed skill execution.

## 6. Permissions and Audit Requirements

- Separate `message_template`, `operational_message`, `message_batch`, and
  `message_delivery` permissions. Require an approval permission for bulk work
  and a higher permission for free-form/override content.
- Internal notes stay internal regardless of a contact's external channel. Do
  not expose them in copy, API adapter payloads, documents, exports, or AI
  context.
- Audit template changes, rendered source/variable hashes, creation, copy,
  queue/send result, consent/opt-out changes, approvals, cancellation, and
  provider callbacks. Keep body access subject to field permissions.
- Mask phones by default; enforce opt-out, purpose limitation, quiet hours, rate
  limits, and configurable retention/deletion. An operator must be able to
  suppress a contact without deleting financial history.

## 7. E2E Test Requirements

1. Create a phone-first customer, an invoice, and a payment reminder; verify
   resolved variables, masked recipient, copy event, and linked timeline.
2. Verify a supplier purchase-request template from a purchase order and an
   internal note remains internal.
3. Preview a bulk overdue-balance reminder; assert exclusions for opted-out/no
   phone contacts and that an unapproved operator cannot copy/queue the batch.
4. Approve a batch with a different authorized user; assert audit, timeline
   entries, cancellation behavior, and no claim of provider delivery in v1.
5. Add provider-adapter contract tests later for webhook signature validation,
   duplicate callbacks, rate limit, failed delivery, and secret non-disclosure.

## 8. Risks / Open Questions

- SMS/WhatsApp consent and message-template rules vary by market; legal policy
  and launch country are prerequisites for direct delivery.
- Determine whether staff may use their own phone copy actions and what evidence
  is sufficient to mark a copy as completed.
- Decide whether contact-level consent may be shared across companies within an
  organization or must be company-specific.

## 9. Suggested Implementation Order

1. Agree data classification, consent, and copy-event semantics.
2. Add contact phone identity/preferences and operational message/template
   persistence.
3. Deliver single-message copy UI plus unified timeline.
4. Deliver batch preview/approval and owner audit views.
5. Introduce provider adapters only after v1 operational controls are proven.

## Milestones and Acceptance Criteria

- Every external-message intent has a template/source/recipient snapshot and a
  truthful status.
- Staff can complete a payment reminder from an invoice without leaving the ERP.
- Bulk work cannot execute without preview, required approval, audit, and
  opt-out enforcement.

## Security and Privacy Considerations

Treat phones, message bodies, delivery metadata, and payment references as
personal or sensitive operational data. Limit retrieval and AI context to the
minimum record scope, sanitize template variables, and prohibit secrets/network
access in AI-generated shells.
