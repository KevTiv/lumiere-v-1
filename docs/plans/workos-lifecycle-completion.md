# Hosted identity and access lifecycle

Hosted deployments use WorkOS. Native login remains disabled whenever WorkOS is
configured; extending native authentication for self-hosting is deferred.

## Identity and login

The immutable `platform_user_id` and existing STDB identity survive migration.
An operator may set `link_platform_user_id` on an exact subject/email/organization
entry in `LUMIERE_WORKOS_ALPHA_ADMISSIONS`, with `allow_provision: true`. The first
verified callback links only that account, and records a control-plane audit row.
Email equality alone never links accounts. Concurrent callbacks read the winning
unique subject binding rather than returning a second identity.

WorkOS supplies the initial display name. Lumière owns editable profile fields.
An address changed at WorkOS is synchronized to credentials and profile together
only after the operator updates the exact approved email for the same subject.
Conflicting account addresses are rejected; verification cannot be set by a
browser profile patch.

Ordinary login returns through `/auth/complete`, preserving a validated local
destination. A pending sealed invitation goes to acceptance; approved founders
without historical membership go to onboarding; missing invitations and suspended
memberships have separate user-facing states. Logout and refresh retain the
provider-owned session boundary. No STDB credential reaches the hosted browser.

## Provisioning and retries

`accept_user_invite` is an internal-only operation. One STDB transaction checks
the invitation, its current issuer, target role, exact verified account, alpha
organization and member limit; then materializes membership, credential/profile
bindings, the policy snapshot, and a private acceptance receipt. A retry for the
same account returns success without duplicating a membership or restoring an
administrator's later revocation. A different account cannot use the receipt.

PostgreSQL identity creation is a separate transaction. It grants no organization
access. Self-service profile changes and projection work commit in one PostgreSQL
transaction; pending work is retried when that user's organization session next
resolves. Row locking serializes projection attempts. This is durable reconciliation
between systems, not a distributed transaction or a claim of immediate delivery
while a tenant is unavailable.

## Roles and administration

Effective access is one active membership's primary role plus active, unexpired,
tenant-local assignments. API context, reducers and policy snapshots use that
model. Shared Rust evaluation canonicalizes view/read and update/write, applies
declared module grants, gives explicit deny precedence over ordinary allows, and
keeps platform-superuser authority explicit. Create is independent of update.
HTTP resource reads and realtime check the same permissions, retaining scoped
session/reference reads needed to hydrate the application.

The hosted UI refreshes effective access every 15 seconds and on focus, and fails
closed on resolution errors. API requests resolve authority before executing.
Existing provider WebSockets revalidate through reconnection within 60 seconds.
Role names and display metadata do not confer authority.

`set_member_access` saves primary/additional roles, local active status and job
title together. Expected role/status preconditions reject stale edits. Omitted
job title preserves its value; an empty title clears it. Department, employee and
company bindings are preserved. Delegated scope, grant ceilings, segregation of
duties, tenant boundaries and the last-administrator guard are enforced on the
server. Delegated user lists are restricted to the administrator’s company.
Assignment ceilings include both role permission strings and organization policy grants;
a wildcard cannot hide the assigning administrator’s narrower denies.
Invitations explicitly choose one initial role; additional roles are
managed after acceptance.

Role deletion retires an unused non-system role. Assigned roles require member
reassignment first. Personal profile saves target the authenticated caller;
organization administrators do not silently change another member's global
profile or provider email.

## Rollout and evidence

Ship the matching generated contract release and module with the API and frontend.
Forward-only platform migration 17 creates the profile projection outbox and
identity-link audit; migration 18 adds the durable acceptance receipt relation.
The storage/ownership census includes all 511 organization-owned tables. Existing
native database credentials still require the operator review documented in
`PRODUCTION_DEPLOY.md`; selecting hosted authentication does not revoke them.

Focused evidence lives in the policy-core tests, API WorkOS tests, shared API
field-policy tests, UI RBAC/profile tests, hosted forwarding tests, role-expiry
tests, and the core in-module access-lifecycle scenarios. RSA signing keys are
generated at test runtime rather than committed as PEM fixtures.

Real WorkOS callback, provider outage, invitation expiry/replay, linked legacy
account, profile edits, role grant/revoke, suspension, logout, refresh and reconnect
must still be exercised on an isolated operator-configured WorkOS stack before
release. Local fixtures do not establish live provider acceptance.

The ignored PostgreSQL lifecycle test runs against an isolated database with
`WORKOS_TEST_DATABASE_URL=... cargo test -p api-server postgres_identity_and_profile_lifecycle_is_atomic --lib -- --ignored`.
It covers concurrent provider callbacks, immutable explicit links, inactive-account
rollback, profile/outbox transaction rollback, and verified-email synchronization.


Member-access replay correction: saves now include `expected_access_revision`,
derived from the last append-only audit ID for the membership and all its role
assignments (including inactive assignments). This detects state cycles such as
grant → revoke → replay and deactivate → reactivate → replay. Exact retries of
the current committed state remain no-ops. The settings read returns the matching
revision, and clients without one must reload before saving. The revised operation input contract is published and pinned in
`lumiere-contracts v0.3.123`. Native runtime and browser coverage verifies exact
retries, stale saves after revocation, and reader denial. No storage schema or forward migration is added for this correction.

Runtime form definitions, labels, role form settings and custom field definitions
are organization-scoped reference reads for authenticated members. They do not
grant business record reads or writes, and explicit read denies still apply.
The established `hr_payroll:read` grant is recognized for payslip and export reads.
