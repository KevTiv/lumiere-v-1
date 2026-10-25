# Approved Alpha org AI bootstrap

Status: the user approved this exact temporary operator scope on 2026-10-24.
No administrator, service binding, runtime profile or certification record has
been created. The access window has not started. The Mistral key/catalog checks passed without
billable calls.

Production inspection found no platform superuser in either the canonical
PostgreSQL profile store or the SpacetimeDB profile bindings. Alpha org also has
no trusted service bindings or certification runtime. The normal registration
reducers require an active platform superuser. Reusing the existing module-owner
token does not satisfy that application check.

## Approved temporary operator

Use the existing production server operator, whose server-verified SpacetimeDB
identity is:

`c2006e9ff9e43cebc0436160b5a1b3a21dea399853183df8b215e5b986ca545c`

This is the existing STDB_SERVER_TOKEN principal. The token stays in Railway.
No token, password, Mistral key or other credential is part of this proposal.

Create an explicit, audited platform operator profile and its Alpha org (1),
company (1) application membership/binding. Grant platform-superuser authority
only for this bootstrap window. This flag is a broad application administrator
capability; it is not an AI-only permission. Do not change either human account.
The operator must have no password, invitation or WorkOS login path.

## Entry and expiry

Use the existing Alpha administrator's normal member workflow. Create a dedicated
role with no permissions and no parent. In the advanced Add Member form, select
company 1, the existing server operator identity above, that role, active/default
membership, and **Temporary setup access (one hour)**. This operation creates no
administrator grant or credential. Existing human accounts and roles stay intact.

The member reducer issues the lease from server time, stores it on the new
membership and profile, and rejects missing/foreign company scope, malformed
leases, replacement of ordinary profiles, and renewal of existing leases. An
identical request replay keeps the original expiry. Keep the canonical platform
profile metadata equal to this verified lease when binding its opaque platform
ID. Do not create a password, WorkOS identity or credential row for the operator.

Before setting the operator's administrator flag, verify its exact identity,
organization/company, empty role, current server-issued lease and canonical
profile binding. The approved module owner can then update only this operator's
scalar `is_superuser` flag. SpacetimeDB SQL cannot construct a profile's Option
fields, so it cannot replace the normal member-creation step. The deployment
must include the new lease-creation and expiry checks before this workflow runs.

Use that authority only to register the dedicated AI spend reader and
certification executor through their existing reducers, prepare the proposed
report_analysis version/fixture, and apply the previously approved USD 1 pilot
configuration after its release gate passes. Other worker registrations remain
outside this request.

Server-verified dedicated identities:

- Gateway writer: `c200fcdf5f03be15ed8fa74747497e2da753e7114dc136f33cae5ddcf01276ba`.
- Spend reader: `c200048b0c37ac6389dcd93b663ac727a8add61620feb27e007814fcbdb546a7`.
- Certification executor: `c200a8a30f289c21e274cbb0db187d136cdf4f862e70db9af9b0bc4b932a3497`.

Give the writer only the required organization-scoped AI runtime permissions.
It must not become a superuser, certify a candidate, change the USD 1 budget,
or promote its own skill. The spend reader remains read-only. The certification
executor remains separate from the operator and writer. Pin its runtime profile
to the verified immutable release image before requesting a certification run.

The exact skill proposal and synthetic fixture are the adjacent
`report-analysis-certification-manifest.proposed.json` and
`report-analysis-certification-fixture.json`. Their local tests passed. A fixture
replay is not live-model or spend-settlement acceptance.

Revoke temporary administrator authority in both canonical and application
profile records when setup ends, on failure, or after one hour, whichever occurs
first. Retain inactive operator/audit records for attribution. Verify revocation
before the first billable provider request. A later bootstrap window needs a new
explicit approval. Preserve existing business rows and human roles throughout.

Independent skill promotion remains required by the existing reducer. Never
create a passing certificate, substitute a development seed, switch identities
to self-approve a release, or bypass its worker evidence checks.

The reserved profile metadata format is `lumiere-platform-bootstrap-v1:<issuedMicros>:<expiresMicros>`. Shared application checks reject expired, future, malformed or overlong leases. Cleanup must also clear the physical administrator flags before any paid call.
