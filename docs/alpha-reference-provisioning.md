# Alpha reference-data provisioning

The Alpha owner is an organization administrator, not a platform superuser.
Custom country/currency reducers retain their superuser checks. Do not enable
development reducers, promote this user, edit generated contracts, or insert
business rows through an admin SQL token to get past missing reference data.

Organization migration 5 installs a fixed, small onboarding country catalog
(AU, CA, GB, JP, NL, US), with tenant-qualified primary keys. It only inserts
missing rows, preserves existing/inactive/customized rows, and links an active
currency only when that currency already belongs to the same organization.
It does not configure tax compliance or create additional currencies.

New tenant bootstrap includes these countries in its durable commit. Existing
tenants use the existing `apply_org_migrations(organization_id)` reducer, which
checks `organization:write` before running any migration. The catalog rows and
migration marker are committed atomically with a durable organization envelope.
The runner also applies any earlier pending organization migrations, including
form configurations and finance separation-of-duties presets.

The operation remains absent from the public session-operation API. The private
Alpha seed job consumes its binding from the pinned contracts package and calls
SpacetimeDB with the Alpha owner's token. `STDB_SERVER_TOKEN` remains read-only
for the job's SQL diagnostics. The optional provisioning step checks that the
owner is not a superuser both before and after migration, and requires the v5
marker before proceeding to VAT creation.

## Release sequence

1. Wait for **Build production SpacetimeDB publisher** for the exact source SHA.
   Its isolated database test verifies production dev-reducer rejection, complete
   bootstrap persistence, additive migration, replay safety, tenant guards, and
   continued rejection of custom country creation by a normal owner.
2. Promote its immutable GHCR digest to the production `spacetimedb-publisher`
   service only. Keep EU placement and the existing sealed publication token.
   The workflow builds an image but never deploys automatically.
3. Observe the publisher's successful module/schema verification marker.
4. Run the private Alpha seed job with `SEED_PROVISION_REFERENCE_DATA=true`, then
   repeat it to verify zero new fixture rows. Keep credentials in temporary
   Railway variables/references, not source or reports. Remove the job afterward.
5. Replace `docs/evidence/alpha-demo-seed-report.json` with verified live evidence.

Until steps 2–5 are observed, the last live result remains **141/143 fixtures**;
country NL and its dependent demo VAT are not claimed as fixed in production.
Even 143/143 fixtures would not mean all 516 tables are populated or every module
has attained U5 readiness. The VAT is demo data and must be reviewed before real use.
