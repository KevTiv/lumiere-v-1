# WhatsApp alpha: reviewed text sending and incoming recovery

## Scope and readiness

The operator flow now has source code for queue -> preview -> explicit confirmation -> one provider request -> acceptance readback -> signed delivery callback -> CRM reply. Live activation is a separate gate: no deployment, merchant credentials, database migration or real message was performed by this PR. Exact-head compilation, contract/runtime and browser tests must pass before release. Keep both provider feature flags off until the pilot checklist is complete.

The previous 727eee3 baseline passed its Rust and disposable PostgreSQL recovery tests. That result does not certify the new operator UI, canonical queue linkage or transport migration 2.

## Operator workflow

In a contact's WhatsApp inbox, staff open the thread and choose **Queue for review**. Queueing does not send. With a configured sender, the canonical CRM reducer atomically creates the matching operational-message intent and binds the thread to the company sender. Browser input cannot choose provider IDs or inject an operational-message link.

A queued row exposes **Review and send via WhatsApp**. The server reloads the current actor, company access, field policy, contact, phone identity, operational message, consent, sender and provider principal. The preview shows the masked recipient, verified sender name and exact body. The resulting immutable review is bound to this actor and message and expires after ten minutes.

Staff choose either a reply within the verified 24-hour customer-service window or a current Meta-approved body-only utility template. The alpha supports at most 100 templates per sender and 20 positional text parameters. Named parameters, marketing, headers, footers, buttons and document-template attachments are not silently converted or omitted. A template's rendered text must equal the queued body; otherwise **Use this text in the composer** creates a new candidate for review while the old message remains unsent.

**Confirm and send once** repeats current authorization, consumes a durable per-message attempt, rechecks authorization immediately before I/O and performs one fixed-origin Meta request. HTTP acceptance is distinct from recipient delivery. An interrupted response remains unknown or attempted; refreshing status never submits another send. There is deliberately no reset-and-resend control for uncertain attempts.

Actual signed status callbacks correlate through the immutable review and durable intent, including callbacks arriving before the HTTP response. Correlation checks organization, account, company, original recipient and provider message ID. The existing provider-principal-protected CRM reducer alone records sent/delivered/failed on canonical business records. A chat saying “I paid” never posts money.

The exception panel exposes only bounded, masked metadata to current integration/message administrators. After correcting a contact or processing issue they can requeue an exact company/account event with an audit reason. Conflicting provider payloads cannot be requeued. Unknown messages on organization-shared senders remain an administrative maintenance case until company ownership is established.

## Deployment configuration

Use an exact web/API/module/contracts release set. This change preserves the published reducer/table signatures, but the SpacetimeDB module must be redeployed for the new queue-link behavior. Existing unlinked queued rows remain unavailable for sending; staff queue a new message after the module upgrade rather than guessing a link.

Required server configuration:

- `LUMIERE_WHATSAPP_META_ENABLED=1`: enables signed ingestion and the incoming worker.
- `LUMIERE_WHATSAPP_SEND_ENABLED=1`: independently enables user-reviewed sending. Leave off while configuring/testing ingestion.
- `LUMIERE_WHATSAPP_GRAPH_VERSION`: an explicit supported `vN.N` Graph version selected and verified during enrollment.
- `LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET`: Meta app secret, server only.
- `LUMIERE_WHATSAPP_META_VERIFY_TOKEN`: high-entropy GET challenge token, distinct from the app secret and phone access token.
- `LUMIERE_WHATSAPP_ACCOUNT_TOKENS`: server-secret JSON array with string `organizationId`, `accountId`, `businessAccountId`, `phoneNumberId`, `credentialsReference`, and `accessToken`. Exactly one entry must match the stored sender. Never place tokens in CRM metadata, browser configuration, repository files or logs.
- `LUMIERE_WHATSAPP_TIMEZONES`: server JSON map of `organizationId:accountId` to an IANA zone, such as `Africa/Kigali`, when quiet hours are configured. Missing or redacted quiet-hour facts block rather than guess.
- The existing PostgreSQL configuration and server STDB token. Both API and incoming worker must use the intended tenant placement and the exact active registered CRM provider identity.

Configure each sender's Meta WABA and phone-number IDs, company binding, active flags, positive daily limit and internal `messages`/`message_status` subscriptions. Set Meta's webhook to HTTPS `/v1/webhooks/whatsapp/meta` and subscribe to Meta's `messages` field. Verify the authenticated STDB token matches the unique active `crm_provider_principal` for the sender; a JWT identity hint is not evidence.

The deployment secret array is an assisted-onboarding alpha mechanism, not Embedded Signup or a token-vault UI. Meta business/app permissions, sender eligibility and account billing must be satisfied separately. Do not bypass Meta enrollment with staff personal numbers.

## Permissions and consent

Grant the dedicated role permission string `operational_message:send` through the existing role permissions workflow to the intended sender staff. CRUD/write permissions alone do not authorize provider sending. Current read permissions and allowed fields are also required for CRM conversations/messages, contacts, contact phone identities, operational messages and contact communication preferences. A masked or omitted required source field stays unavailable; the sender cannot reveal it by switching to a privileged read path.

The recipient must have an explicit company-scoped WhatsApp opt-in. Inbound STOP/unsubscribe commands persist suppression before acknowledgement; a delayed callback does not reopen a reply window. This alpha has no self-service STOP reset. A future separately reviewed re-consent workflow must not clear suppression implicitly.

The sender's configured limit is capped at 1,000 attempts per rolling 24 hours and 20 per minute for alpha. Limits are acquired transactionally with the attempt. They limit volume, not a guaranteed monetary bill; Meta billing/rates remain external. Failed and unknown attempts still consume the conservative volume allowance.

## Private transport storage and process

Run the explicit administrative command once against the reviewed target database:

```sh
LUMIERE_BIN=whatsapp-inbox-worker lumiere-runtime-entrypoint --migrate
```

Normal API/worker startup does not apply DDL. Migration 1 remains byte-for-byte unchanged; migration 2 adds immutable reviews, recipient-window/suppression facts and provider-correlation indexes. A checksum mismatch stops startup. Review restricted database grants, encryption, backups, retention, log redaction and regional placement before activation. These tables are private transport evidence, not an alternative accounting/CRM authority.

Run `whatsapp-inbox-worker` as a separately supervised service from the shared Rust runtime image, with `LUMIERE_BIN=whatsapp-inbox-worker`. The HTTP process accepts and durably stores events; the worker delivers them through canonical reducers with fenced leases and bounded retries. Monitor backlog, oldest unprocessed receipt, quarantine count and worker health. The existing CLI maintenance path remains `--requeue ORG ACCOUNT EVENT` for authorized operators; the user-facing path additionally enforces current company and actor authority.

## Validation and pilot acceptance

Required proof includes:

1. Two concurrent confirmations result in one attempted provider request; new review IDs cannot bypass the per-message claim.
2. A lost HTTP response, process restart or unknown provider outcome cannot auto-resend. An early signed callback binds the exact original attempt, with wrong recipient/account/company denied.
3. Revoked membership/send permission/consent, archived identities, altered body/recipient/sender/template or expired review block I/O. Quiet-hour and customer-window boundaries are enforced.
4. A signed inbound message and duplicate produce one canonical CRM message. Late delivery events do not downgrade delivered state. Unknown contacts/media remain in durable quarantine.
5. Current-actor triage is bounded, field-safe and company/account-scoped. Conflicting events remain blocked.
6. Browser users can queue, inspect the exact review, confirm once and refresh acceptance/delivery without reposting. Switching organization/contact removes pending UI reviews.
7. A controlled test-sender round trip proves queue -> send -> real callback -> reply, followed by explicit pilot acceptance with the organization's own permitted sender.

Focused node tests: `node --import tsx --test lib/whatsapp-dispatch.test.ts` from `frontend/web`. Rust CI includes `routes::whatsapp_meta` tests and a disposable local `*_whatsapp_test` PostgreSQL database. No passing result for the new head is assumed merely because tests are present.

## Deliberate remaining limits

This is text/utility-template alpha, not all WhatsApp features. Media references are retained but media bytes, malware scanning, document ingestion and invoice PDF attachments are not implemented. Business-scoped IDs without a verified phone/contact mapping require triage. Bulk campaigns, marketing automation, embedded merchant signup, arbitrary template components, automatic re-consent and provider-certified production acceptance remain outside this slice. Copy-first messaging remains a fallback and never claims provider delivery.

## Server-approved sender ownership

Both incoming routing and outgoing credentials use the same deployment-owned enrollment array. A tenant-editable WhatsApp account row does not establish ownership of a WABA or receiving phone number. Signed provider assets must first match a unique provisioned organization/account/reference; only then is that exact account read and checked. Duplicate asset or account enrollments fail closed. Another tenant copying provider IDs into its settings cannot capture or reroute callbacks.

Provision the same enrollment mapping on the API and incoming worker. Missing enrollment produces a retryable failure rather than falling back to an unverified account-table scan. Credential rotation preserves exact ownership; changing the ownership binding quarantines already-received events instead of silently moving them to another organization.
