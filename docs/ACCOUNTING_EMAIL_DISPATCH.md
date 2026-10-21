# Reviewed accounting email dispatch

Invoice email and overdue reminders use one reviewed queue record per send. Operators select one recipient, approve the exact plain text and PDF attachment choice, queue the message, then explicitly choose **Send reviewed email**. Queueing never calls the email provider. The legacy `/v1/mail/dispatch-queued` endpoint is disabled and returns HTTP 410 without contacting the provider. Existing legacy queue entries must be inspected and deliberately re-prepared through the per-message review flow; they are never drained automatically.

## Configuration

The API server requires:

- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for the outbound provider.
- `LUMIERE_REPORT_RENDERER_URL` for messages whose reviewed attachment choice includes the managed invoice PDF. The existing authenticated invoice PDF renderer and issued document snapshot are reused; no caller-selected URL or uploaded attachment is accepted. PDFs are limited to 8 MiB.
- `LUMIERE_REVIEWED_MAIL_STDB_TOKEN`, a dedicated SpacetimeDB service identity token. It must differ from `STDB_SERVER_TOKEN`. Do not use the database owner token or an interactive user's token.

Register the dedicated identity for each enabled organization through the existing operator-only `register_cold_tier_service_identity` procedure, with a platform-owned opaque binding ID and `service_name = "reviewed_mail_dispatcher"`. The registering administrator must be distinct from the registered identity. This repository change does not create, register or rotate production credentials.

Production bootstrap and the read-only `--verify-reviewed-mail` check are
covered in [Production deployment](./PRODUCTION_DEPLOY.md#optional-reviewed-email-readiness).
The check verifies existing bindings only and never rotates a dispatcher token.

The API verifies the token against the database-authenticated identity and active organization service binding before claiming a message or contacting Resend. Missing provider credentials, service credentials, binding or required rendering fails before provider delivery. The database independently requires the active registered service identity to record provider acceptance for reviewed invoice email; an ordinary SDK caller cannot mark a claimed reviewed message as sent or promote legacy chatter into reviewed dispatch evidence through supplied receipt metadata.

## Authority and consistency

The session must have message read/write, template read/write, and invoice read access in the invoice's original organization and company. Rendering retains the document pipeline's invoice-line and branding read requirements. `claim_reviewed_mail_delivery` remains denied to generic HTTP operations and checks active membership in the reviewed company directly in the module.

Per-send text is stored in the existing version 2 `invoiceReview` metadata envelope alongside the original template fields and invoice revision. Queue and claim validate the current template and posted invoice atomically. PDF bytes are rendered and frozen before the claim. The module consumes `queued` into `dispatching` once; concurrent or repeated claims fail. The provider request digest covers the exact serialized message and PDF bytes; the provider idempotency key additionally binds organization, message and review IDs. Queue, claim and acceptance emit organization commits for durable reconstruction.

## Outcomes and recovery

- **Queued** means the exact reviewed record exists. No provider send is implied.
- **Dispatching / unknown** means a dispatch claim was consumed. The provider may or may not have accepted the request. The UI permits read-only status checks and will not automatically retry or queue a replacement.
- **Sent / dispatch recorded** means the provider accepted the frozen request and the matching receipt was recorded. Recipient delivery is not confirmed.

An outage after a claim, a lost provider response, or a failed receipt write leaves the original request claimed. Inspect its review ID, request digest, organization commit and provider logs before making any manual operational decision. There is deliberately no reset-to-queued or automatic resend path. Do not infer non-delivery from a missing receipt, and do not replace the original message merely because status is unknown.

Provider integration tests use an injected local HTTP endpoint. They confirm the exact attachment bytes, request payload, idempotency header and no transport retry; they do not claim real email delivery. The existing `run_accounting_post_invoice_test` module runner covers queue replay, scoped and stale claims, claimed replay, ordinary SDK receipt denial, adversarial legacy-metadata promotion attempts and service-bound acceptance. The API test suite also confirms that the batch endpoint returns HTTP 410 without provider work.
