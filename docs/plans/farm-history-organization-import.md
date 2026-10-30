# Farm history organization import

The user requested a separate organization named **Umunupfu Chicken | Mugisha Farm**,
using their existing WorkOS identity, with historic company data from the supplied
CSV folder. The user approved proceeding with the scoped organization-limit
exception, organization creation, and historic seeding. Deployment and import
are tracked separately from local preparation.

## Proposed organization

- Organization name: `Umunupfu Chicken | Mugisha Farm`
- Organization code: `UMUNUPFU_MUGISHA`
- Company legal name from the source: `UMUNOPFU CHICKEN LTD`
- Company code: `UMUNOPFU`
- Currency: `RWF` (zero decimal places)
- Timezone: `Africa/Kigali`
- Country from the source address: Rwanda (`RW`)
- Existing Alpha organization and its records: retain as a separate tenant.

Nyabugogo, Kicukiro, Kimironko, and Gisimenti are business locations in Kigali,
as confirmed by the user. Model these as locations within the company. Keep
the source spellings and shop-specific relationships. Zinia is also a source
shop label; do not infer its precise geographic meaning.

No Mugisha Farm transaction data is identified in this source. Do not fabricate
farm purchases, production, animals, stock, tax settings, or bank transactions.

## Exact organization-limit exception

`LUMIERE_ALPHA_ADDITIONAL_TENANT_APPROVAL` has one strict value:

```text
<canonical-64-hex-identity>:<existing-organization-id>:UMUNUPFU_MUGISHA
```

The shared policy parser rejects missing or malformed values, lists, wildcards,
zero IDs, noncanonical identities, and invalid target codes. The API must match
the authenticated identity, its resolved source organization, and the exact new
code. The module must independently match all membership history: exactly one
row, active, in the approved source organization. The target code must not exist.
No prior revoked membership is ignored. Creation adds a second membership, so
retries and later revocation cannot restore the exception. Regular founder
admission remains unchanged when this exception does not match.

The API uses a runtime value. The SpacetimeDB module uses a compiled value. Set
the same exact value in the API environment and production module build input.
The production build passes the repository variable through the reusable module
workflow. Both admission values contribute to the artifact cache fingerprint.
Do not enable developer reducers or change the general Alpha quota.

The approved source session receives the code-only new-tenant currency catalog.
This allows RWF to be seeded in the new organization without reusing an Alpha
currency row. Bootstrap still uses the authenticated user's internal credential.
No credential is sent to the browser or copied from another account.

## Release and activation sequence

1. Review the patch, then obtain explicit production publication/deployment approval.
2. Recheck the current WorkOS subject, profile, and source organization against the
   private activation proposal. Verify complete membership history and absence of
   the target organization. The authenticated `session/field-access` endpoint
   provides identity and source organization without exposing a credential.
3. Set the exact build input. Build and publish a new immutable production module
   and Rust runtime through the existing release process. Preserve existing data.
   The public reducer and table contracts are unchanged.
4. Set the same exact API runtime value and deploy the API runtime. Verify ordinary
   founder denial and the exact approved onboarding path.
5. Submit the prepared bootstrap request through the user's WorkOS session. Read
   back the new organization, owner membership, role, company, currency, settings,
   form configurations, audit evidence, and persisted tenant commit. The read-only
   `GET /api/bootstrap/tenant?code=UMUNUPFU_MUGISHA` lookup returns basic metadata
   only when the verified identity has an active membership in that organization.
   Use it to recover the new ID before changing the session admission pin.
6. Pin this user's WorkOS admission to the returned numeric organization ID and
   restart the API with that admission. The current WorkOS session resolver does
   not provide an organization switcher. Preserve the Alpha membership. Verify
   the new resolved scope before any import operation.
7. Load tenant-owned reference records and only then linked business records.
   Bind returned database IDs. Reject missing or cross-tenant references.
8. Remove the runtime exception after creation. Remove the compiled exception
   in a later immutable module build. A retained compiled value cannot create a
   third organization because membership history consumes the exception.

## Source preparation

Run locally, with output outside the repository:

```bash
python3 scripts/farm-history-preflight.py '<CSV-folder>' '<private-output-folder>'
```

This command makes no network requests and performs no production writes. It
preserves source rows, filenames, hashes, and row coordinates. Decimal amounts
remain decimal strings. It marks exact repeats, conflicting versions, invalid
dates, overlapping reporting periods, and arithmetic differences. Re-running on
the same source produces identical output.

The source contains shop audit periods, separate customer sales, a January 2023
debt snapshot, staff names with shop assignments, an October 2022 inventory
count in pieces and kilograms, monthly summaries without a year, and templates.
The user confirmed kilograms for product quantities and RWF for currency.
Retain source piece counts separately without inventing a fixed pieces-to-kg
conversion. The user also authorized logical location corrections. The Kimironko
file has long report sequences headed Kicukiro and Gisimenti before Kimironko.
Prefer explicit dated report headings and preserve the continuous file ledger as
a separate source series. Retain both original labels and the reason for each
inference. Do not silently merge ambiguous product labels such as FILLET.
Source rows that omit a quantity or amount remain unknown.

The duplicate index covers primary product datasets. When supplementary rows
differ, the source archive retains both versions and the audit is flagged. A
duplicate primary dataset does not prove that its expense or settlement rows
are duplicates. Do not add weekly and monthly summaries to the same sales total.

## Table order and business limits

| Source | Destination and dependencies | Import limit |
| --- | --- | --- |
| Organization and company headers | organization, company, currency, country | New tenant references only |
| Shop names | warehouse, stock_location under the same company | Internal transfers are not external customer sales |
| Product descriptions | product_category, uom, product | Confirm units and aliases; old prices do not establish current prices |
| Named customers and suppliers | contact | Use verified names; rent labels are not supplier identities |
| Shop audits | Historic observations, then a reviewed accounting migration | Consumed stock cost is not a purchase invoice |
| Customer sales summary | Historic sale observations | Product, unit, invoice date, tax, and settlement may be unknown |
| Debt lists | Historic dated balance snapshots | These do not establish current open receivables or payables |
| Inventory count | Historic dated inventory snapshot | Do not set current stock to an October 2022 count |
| Staff names | Historic staff references | No guessed hire dates, active contracts, or logins |
| Monthly reports and templates | Source archive | Do not invent a year or post an undated form |

The existing CSV endpoints do not by themselves establish the requested history:
some create draft records with zero parent totals or defaults, and some CRM
imports are contained behind a runtime gate. Use supported domain commands with
resolved references where their semantics fit. A history record must not be
forced into an incompatible table. Date, unit, shop, and source conflicts must
remain visible until resolved. Posting an accounting migration needs reconciled
period totals and approved accounting treatment.

## Completion evidence

Creation is complete only after the user's WorkOS session resolves to the new
organization. Import completion requires stored records, tenant/company relation
checks, reconciliation to the source, refreshed UI evidence, and a repeat run
that creates no duplicates. Local parsing and compilation do not prove hosted
creation or completed import. The prepared observation package is not a posted
accounting ledger.
