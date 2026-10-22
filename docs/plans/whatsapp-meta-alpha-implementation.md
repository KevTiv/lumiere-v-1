# WhatsApp Cloud API alpha — implementation and release gates

**Status (2026-10-22):** first provider-boundary slice implemented on branch `codex/whatsapp-meta-alpha-webhooks-20261022`. This is **not** production provider certification. Keep live traffic disabled until the open gates below are satisfied.

## Scope

The alpha's first end-to-end goal is: authorized employee selects an open invoice, previews an approved WhatsApp reminder, sends it through the company's connected business sender, sees actual provider delivery, and receives the customer's reply in the linked CRM inbox. The provider must never create a financial receipt or change a posted invoice from a chat.

We reuse:
- `spacetimedb/src/integrations/whatsapp_business.rs`: organization/company-scoped account mapping, phone-number ID, business account ID, secret references, health and status.
- `spacetimedb/src/core/operational_messaging.rs`: approved templates, operational intents, copied-versus-sent truth, consent and batch review.
- `spacetimedb/src/crm/inbox.rs`: conversations, provider principal and immutable callback-event receipts.
- `api-server/src/routes/whatsapp_webhooks.rs`: existing *internal* signed callback contract, intentionally preserved for compatibility.
- `api-server/src/routes/whatsapp_meta.rs`: direct Meta webhook adapter added by this slice.

## Slice A — inbound Meta webhook boundary (implemented in source)

- Public callback mounted under the API's `/v1` prefix: `GET/POST /v1/webhooks/whatsapp/meta`.
- GET verifies the configured challenge token and echoes `hub.challenge` only for `hub.mode=subscribe`.
- POST verifies `X-Hub-Signature-256` over the **raw** body with the server-only Meta app secret.
- Accepts batched Meta WABA envelopes, looks up the exact stored WABA ID **plus** receiving phone-number ID before choosing the organization/account, and refuses missing/ambiguous/disabled connections.
- Supports known-contact *text* messages and status updates for existing linked outbound intents. Normalized callbacks are forwarded through the existing `ProviderWebhook` internal route authority and organization-bound reducer principal.
- Events use provider IDs and stable per-item fingerprints. No 5-minute freshness cutoff applies to Meta-delayed callbacks. No delivery is asserted merely because a message was copied.
- When a batch partially succeeds, the canonical provider-receipt ledger makes replayed successful items idempotent. Non-200 responses allow Meta retries.

## Configuration and manual smoke test

1. Register a Meta developer app and WhatsApp Cloud API test sender.
2. Configure server-only `LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET` (Meta App Secret) and `LUMIERE_WHATSAPP_META_VERIFY_TOKEN` (high-entropy webhook challenge token). These values are **not** the phone-number access token.
3. Set the Meta App callback URL to the deployed HTTPS `/v1/webhooks/whatsapp/meta` path and provide the verify token for the GET handshake.
4. Subscribe the app to each intended business account and to Meta's `messages` webhook field. In Lumière's internal account record, enable both `messages` and `message_status` callback capabilities as required by the CRM provider principal checks.
5. Create a unique active `WhatsAppBusinessAccount` binding with matching Meta business account ID and phone-number ID. Register the dedicated server executor identity as that account's active CRM provider principal. Do not put Meta tokens or the App Secret in SpacetimeDB.
6. With an existing phone-first CRM contact and eligible WhatsApp identity, deliver a signed inbound text event, then send a duplicate. Confirm exactly one conversation message and one immutable event receipt. Test a second organization, disabled sender, invalid HMAC, malformed payload, unknown sender, and mismatched WABA/number.
7. Do not enable outbound sending or unrestricted production webhooks until the following release gates are addressed.

## Release gates remaining (not implemented by Slice A)

1. **Durable unmatched inbox and triage.** Unknown contacts, business-scoped user IDs and non-text events (images, documents, audio, interactive replies) must be stored without creating a fabricated CRM identity or losing messages when Meta's retry horizon expires. Currently unsupported events fail closed with a retryable error, which is not a substitute for a dead-letter queue.
2. **Outbound delivery and attempt lifecycle.** Add a durable claimed outbox, provider-message ID binding before status processing, scoped credential resolver, rate/budget limits, separate `accepted`/`sent`/`delivered` outcomes, and explicitly reviewed recovery for uncertain requests. Do not build a blind retry sender.
3. **Actual Meta template bindings and window policy.** Map internal templates to Meta-approved template IDs/names/languages/categories; recheck 24-hour service window, current recipient consent/opt-out, number eligibility, current role access, company scope and template approval at dispatch time.
4. **Operator UI completion.** Connect real inbound threads and statuses to CRM, invoicing, sales, payments and purchasing surfaces. Provide role-aware reply, assignment, attachment/document preview and a complete audit trail. Copy-to-WhatsApp remains available as a truthful fallback.
5. **Provider onboarding and production proof.** Confirm Meta app/business permissions, embedded-signup/coexistence eligibility per merchant, data retention/local policy, secret rotation, deployment callback reachability, quotas/cost controls, operations alerting and live human acceptance.

## Test matrix

- GET: wrong token/mode and missing secret denied; valid challenge echoed verbatim.
- POST: unsigned/wrong-key signature denied; signature validated on unchanged raw bytes.
- Provider mapping: duplicate/unknown WABA/number or disabled account fails closed; cross-organization routing impossible.
- Replay: duplicate message/status does not create duplicates; conflicting replay rejected.
- Status: only a server-linked outbound operational message is affected; late `sent` after `delivered` does not downgrade; `read` never downgrades to `sent`.
- Unsupported: unknown contact, non-phone identity, unknown media, unknown provider status does not falsely claim processed.
- Permissions: inactive/revoked provider principal and company-scope mismatch denied by the canonical reducer.
- E2E: account onboarding, invoice reminder approval, real provider send, reply, document attachment, and offline draft must be proven before live alpha rollout.

## Integration architecture

```text
Meta Cloud API (signed webhook) -> Rust API /v1/webhooks/whatsapp/meta
  -> verified WABA + phone-number mapping (server SQL)
  -> dedicated provider principal / canonical STDB reducer
  -> CRM conversation + immutable provider event receipt
  -> scoped query + inbox UI

ERP reviewed message intent -> durable provider outbox (next slice)
  -> authorized worker -> Meta Graph API
  -> provider-message ID correlation -> status callbacks -> same CRM/ERP records
```

Meta docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
Meta webhook subscriptions: https://www.postman.com/meta/whatsapp-business-platform/request/26gui66/subscribe-to-a-waba

This slice does not modify production credentials, hosted configuration, or existing published contracts.
