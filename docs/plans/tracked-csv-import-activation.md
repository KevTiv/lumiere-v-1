# Tracked CSV import activation

The tracked import path binds one confirmed file to a request ID and reads only the
job carrying that ID. Retrying the same bytes, file name, entity and selected company
or currency returns the existing result, including partial, failed and rolled-back
results. A corrected file needs a new request ID. Existing untracked reducers remain
available for older callers.

## Release and deployment prerequisites

The source adds `import_csv_tracked`; the pinned `lumiere-contracts` v0.3.104 package
does not expose it. Before enabling this path in production, regenerate and validate
the canonical reducer IR, generated operation metadata, SDK and contract package from
the changed module. Release an immutable contract version through the approved release
workflow and update consumers to that real version. Deploy the module and matching
API server before the frontend. Draft source changes do not establish deployment or
published-contract availability.

The frontend uses the dedicated authenticated `/api/import/:entity` route rather than
inventing a generated operation descriptor. The API checks availability of the new
wrapper. An unavailable tracked deployment returns 503 and an actionable message;
the frontend never sends a supported tracked request through a legacy reducer fallback.

## Exact result and retry behavior

The modal creates a random 32-character lowercase hexadecimal request ID when the
user confirms the file. It retains the same ID and frozen CSV bytes and scope while
the modal stays open, even if the POST response is lost. Result lookup begins after
the POST settles. “Check results” reads the exact request, and “Retry same submission”
resends the frozen request. Job IDs and scope IDs are decimal strings in HTTP payloads
to preserve u64 precision. A changed active organization or company hides results and disables
the request read.

Exact result reads enforce organization, authenticated principal, selected company
context, entity and product currency. They return the complete error list for that
job without the organization-wide 500-row cap. Field permissions remain enforced;
redacted error details have an explicit notice. A failed read hides cached job details.
The modal does not automatically choose an unrelated recent job. Once a terminal
receipt is visible, importing another file creates a new submission; it does not retry
the original terminal job.

The seven previously blocked entities now have reviewed governed read projections:
`country`, `currency`, `currency_rate`, `uom_category`,
`knowledge_article_category`, `product_variant`, and `hr_expense_sheet`. Country,
currency, currency-rate, UOM-category and product-variant projections are registered
directly. Knowledge categories and expense sheets reuse their existing canonical
projections through explicit permission aliases. Tracked activation is fail-closed for
`knowledge_article_category`, `product_variant`, and `hr_expense_sheet` until
their reducers validate every parent relation inside the current organization and
company. Automatic exact-result handling is enabled in source for `country`,
`currency`, `currency_rate`, and `uom_category`, but remains unavailable at
runtime until the contract and module release prerequisite above is complete.

All existing tracked file modals pass selected company context. Product imports retain
their required currency from the selected pricelist. Other CSV bytes are unchanged;
the HR payslip hash-based readback is replaced by the exact request receipt only on
the tracked path. Cache refresh is limited to the affected resources in the frozen
organization/company scope, including `stdb` and `typed-stdb` query namespaces.

## Validation and acceptance

The integration worktree includes native, API, dependency-free request, and mounted
React tests for the tracked protocol. Focused results must be recorded against the
combined v0.3.104 lineage before release. Full frontend typechecking and browser
acceptance remain required.

Before release, exercise two concurrent imports of the same entity, duplicate POST
after response loss, same-token changed bytes/scope rejection, partial/failed outcomes,
more than 500 errors, field-grant revocation, company switching, and unavailable-wrapper
responses. Check actual pinned generated artifacts and deployed runtime together.
