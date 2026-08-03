# CRM identity verification proof contract

This contract closes CRM-RI-008's identity-verification trust gap. A CRM role,
including one with `contact_identity:verify`, is not evidence that a phone value
is controlled by the contact.

## Trust boundary

- `contact_identity_verification_authority` is a private singleton containing
  the exact SpacetimeDB identity used by the server/provider adapter.
- Initial configuration requires the active global server superuser. Rotation
  requires both global-superuser status and the currently configured issuer
  identity. Organization roles and CRM permissions cannot select or replace it.
- Deployments must configure the authority before accepting provider callbacks.
  The proof reducer fails closed while it is absent.
- `verify_contact_identity` remains only for binding compatibility and always
  rejects. It cannot transition an identity even when the caller has the legacy
  verify permission.

## Trusted adapter input

After independently validating an OTP result or authenticated provider event,
the adapter calls `record_contact_identity_verification_proof` as the configured
authority. It supplies:

- the organization, company, contact, identity, and normalized E.164 value that
  the provider verified;
- method `otp` or `provider_attestation`, provider name, and a provider
  idempotency reference;
- a `sha256:` evidence digest, never the OTP, signature, callback body, or other
  raw secret; and
- issue and expiry timestamps whose validity window is at most 15 minutes.

The reducer reloads the active contact and identity, requires exact tenant,
company, contact, and current-number equality, and rejects archived, deleted,
opted-out, expired, future-issued, malformed, or stale-number evidence. A valid
proof and the verified identity transition commit atomically.

## Persistence and retries

`contact_identity_verification_proof` is private and immutable. It records the
scope snapshot, method/provider, digest, provider reference, validity window,
exact recording principal, and server timestamp. Raw evidence is neither stored
nor written to audit metadata.

Provider callbacks may be delivered at least once. Repeating the exact provider
reference and contract is idempotent and creates no second artifact. Reusing a
reference with different evidence or scope fails. Changing the normalized
number resets the identity to unverified and makes the historical proof
ineligible for replay; the immutable artifact remains audit evidence.

## Adapter boundary and deployment blocker

This repository does not currently contain an OTP delivery service or an
authenticated CRM provider callback adapter. This change deliberately does not
generate, return, log, or deliver OTPs. The UI therefore exposes verification
state but no manual Verify action. A production adapter must authenticate the
provider callback, hash its evidence, provision/use the configured server
identity, and call the trusted reducer. Until that adapter exists, identities
remain unverified through user-facing flows.

Historical verified rows are not migrated. The CRM integrity inventory reports
any verified identity lacking a current-scope immutable proof for separate
quarantine/remediation.
