# WhatsApp Cloud API alpha — durable transport and release gates

## Current scope

PR #251 now adds a durable inbound path, a guarded one-shot outbound transport primitive, and dispatch eligibility tests. This is not a complete live WhatsApp product. The native webhook is disabled by default. No production configuration, messages, credentials or database migrations have been applied by this PR.

The first product acceptance goal remains: an authorized employee reviews an invoice reminder, sends it through the company's connected WhatsApp number, sees verified delivery, and receives a customer reply in the existing CRM thread. Incoming payment claims never post financial receipts.

## Implemented source

| Component | Behavior |
| --- | --- |
| Native callback | GET challenge and POST raw-body HMAC verification at `/v1/webhooks/whatsapp/meta`; exact WABA + receiving-number mapping before tenant selection. Both methods require `LUMIERE_WHATSAPP_META_ENABLED=1`. |
| Account and identity mapping | Handles the camelCase rows actually returned by `StdbClient::query_sql`, including unwrapped options. Missing or malformed company IDs fail closed instead of broadening scope. Wallet-only identities are not WhatsApp recipients. |
| Durable inbox | One PostgreSQL transaction persists the entire verified event batch before HTTP 200. Message identity is independent of batching; identical events deduplicate. Conflicting content is retained separately in quarantine, never overwritten. |
| Unknown contacts and media | Raw provider event metadata is preserved, including business-scoped sender IDs and media references. Unsupported events reach quarantine instead of exhausting Meta retries and disappearing. No external media URL is fetched. |
| Inbox worker | `whatsapp-inbox-worker` claims with `FOR UPDATE SKIP LOCKED`, uses fenced 60-second leases, bounds canonical processing to 45 seconds, retries transient failures with backoff, and quarantines unresolved failures after ten attempts. Expired leases recover after restart. |
| Canonical CRM handoff | Rechecks the original tenant/account/company binding and uses the existing provider-principal-protected reducers and immutable event receipts. Delayed callbacks do not have the old five-minute cutoff. `read` is projected as delivered while the original event remains retained. |
| Operator retry | `--requeue ORG ACCOUNT EVENT` only requeues an exact scoped quarantine record, appends audit evidence, and cannot revive conflicting or processed records. It does not bypass canonical validation. |
| Send primitive | A durable outbox intent freezes scope, review and payload digests. A claim is committed before one HTTP request. Fresh authorization is checked before claiming and immediately before network I/O. Attempted/unknown requests are not automatically replayed. |
| Send policy | Explicit opt-in, opt-out, actor permission, sender state, quiet hours, exact reviewed sender/recipient/content, customer-message-based 24-hour reply window, and fresh approval of the exact Meta template are required by the policy checker. |
| Result semantics | A valid provider message ID records acceptance, never recipient delivery. Timeout, malformed success or server error remain unknown; there is no invented provider idempotency guarantee. |

### Important outbound limit

`outbound::send_once` is deliberately not exposed as an HTTP/harness endpoint and has no production caller. `FreshAuthorization` has no default implementation. A canonical reviewed-message operation, current permission/consent/template reads, scoped credential resolver and canonical provider-ID binding must land before enabling sending. The policy tests and transport primitive do not establish that these business integrations are complete.

## Storage ownership decision

The private `lumiere_whatsapp` PostgreSQL schema owns transport receipts, leases, quarantined payloads and send attempts only. It cannot create contacts, change invoices, post payments or independently authorize an ERP operation. SpacetimeDB remains business authority; browser mutations still use the released IR contracts.

This is an explicitly installed infrastructure schema with its own immutable checksum ledger, not a change to the already released ERP projection migration catalog. `whatsapp-inbox-worker --migrate` is the only DDL entrypoint. HTTP requests and normal workers verify the installed version and fail closed on missing/mismatched schema. A later SQL change requires a new reviewed migration version, not editing a deployed v1 body.

The API and worker use the configured PG pool and existing TLS policy. The transport schema revokes PUBLIC access. Deployment must provision dedicated least-privilege runtime grants, encryption/backup coverage and approved payload retention before real tenant data is admitted. No public resource exposes raw inbox JSON. Quarantined media **references** are retained; media bytes are not downloaded, so this is not document archival.

Limits: 1 MiB webhook body, 100 events per request, 10,000 outstanding events per receiving account. Exact retries still deduplicate at capacity. New writes fail rather than acknowledge unpersisted data when storage/capacity is unavailable.

## Deployment sequence (not executed)

1. Review transport storage ownership, privacy/retention, tenant placement and runtime grants. Validate the target database separately from existing ERP projection migrations.
2. Configure `PG_*` using the established production TLS policy; run the built `whatsapp-inbox-worker --migrate` under the migration administrator. Subsequent workers must not have schema-management privileges.
3. Configure `LUMIERE_WHATSAPP_META_ENABLED=1` in the test API and worker, plus server-only `LUMIERE_WHATSAPP_WEBHOOK_APP_SECRET` and `LUMIERE_WHATSAPP_META_VERIFY_TOKEN` in the API. These are distinct from the sender access token.
4. Use the test app's HTTPS callback `/v1/webhooks/whatsapp/meta`. Subscribe to Meta's `messages` field only. Create an unambiguous active WABA + receiving-number binding and register the configured STDB server executor as the account's CRM provider principal. The internal account must permit both `messages` and `message_status` capabilities.
5. Run the dedicated `whatsapp-inbox-worker` process with the expected source placement and `STDB_SERVER_TOKEN`. The API does not secretly start a worker. Rehearse known-contact text, unknown identity, media references, duplicate events, storage outage, worker restart and delayed statuses.
6. Inspect scoped quarantine metadata through the operator database tools without exporting raw payloads. Fix the canonical contact/configuration where appropriate, then use `whatsapp-inbox-worker --requeue ORG ACCOUNT EVENT`. This is a privileged operator command, not a substitute for the planned user-facing RBAC triage UI.
7. Keep outbound disabled until the remaining canonical bridge and live proof are complete. Never manually reset attempted/unknown outbox rows to trigger another send.

## Remaining code and release gates

- Canonical message review/claim and `FreshAuthorization` implementation: atomically bind the actor, current company permissions, exact recipient, source revision, consent and approved content; publish any changed IR contracts normally.
- Meta template synchronization and expiry/approval refresh; retain original customer message timestamps for the service window. The current policy code accepts server facts but does not itself retrieve them.
- Per-account credential resolution, budget/rate limiting, canonical provider-message-ID correlation, and reviewed unknown-send recovery. The prepared sender is not yet a runnable dispatch worker.
- Authenticated CRM quarantine/status UI and controlled contact linking; attachments through the managed document system with scanning, retention and field authorization. Inbound attachments currently retain references only.
- Regional tenant/source routing review: the worker currently uses the configured STDB source. Do not enable it for organizations placed on a different cell without authoritative placement resolution.
- Queue health/oldest-age/capacity alerting, graceful shutdown, retention/purge policy, restricted grants and restore rehearsal.
- Meta permissions/onboarding, template approvals, test sender and production business ownership. Provider credentials, real delivery and operator/browser acceptance remain external proof, not implied by unit tests.

## Validation

Tests cover real camelCase database rows, malformed optional scope, retained unknown media/IDs, stable event keys, conflicting payload fingerprints, eligible contact identity selection, service-window boundaries, consent/permission revocation, recipient/sender changes, template approval freshness and uncertain provider outcomes.

A dedicated PostgreSQL integration test covers repeated callback deduplication, conflicting-event quarantine, competing workers, expired-lease recovery, stale-worker denial and exact-scope operator retry. CI adds these checks to the existing Rust job with a separate disposable `lumiere_whatsapp_test` database, not another full-stack workflow.

```sh
cargo test --locked -p api-server --lib routes::whatsapp_meta
# Dedicated localhost database only; never point this test at a tenant database.
WHATSAPP_TEST_PG=1 PG_HOST=127.0.0.1 PG_DATABASE=lumiere_whatsapp_test \
  cargo test --locked -p api-server --lib routes::whatsapp_meta \
  -- --include-ignored --test-threads=1
```

No local Rust/compiler or live provider test result is claimed in this document. Exact-head CI and a deployed canonical-CRM proof remain required before merging/enabling.

## References

- Meta messaging policy: https://business.whatsapp.com/policy
- Native webhooks: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview
- Existing provider authority: `spacetimedb/src/crm/inbox.rs`
- Existing business messaging: `spacetimedb/src/core/operational_messaging.rs`
