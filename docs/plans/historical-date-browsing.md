# Historical date browsing

## User behavior

The owner overview and Sales, CRM, Purchasing, Expenses, and Reports insights
start with **All history**. The shared date selector also offers today, recent
calendar periods, year to date, and custom start/through dates. A user can type
any supported calendar year directly; the control has no rolling lookback or
maximum-span restriction. Charts coarsen their buckets to cover the selected
span without truncating older dates.

Module insight selections are stored in `?period=`. Their Browse links retain
the selected period, transaction currency filter, and calendar zone. The list
drilldown uses an admitted module/tab/business-date mapping, and rejects an
invalid period or zone visibly. Clearing the period retains other URL filters.

The Settings **Data import** section now includes **Available source history**:

`/settings?section=imports#available-history`

It shows the selected company's complete saved source-review inventory: earliest
and latest known business dates; dated, undated, and invalid/ambiguous counts;
review states; dataset coverage; year/month shortcuts; and paginated source rows.
Each row retains its file, row number, original values, current interpretation,
and review revision. All history includes undated and ambiguous rows. Bounded
date filters match overlapping dated observations, with separate filters to
inspect unknown dates.

**Confirmed source** means a review decision. It does not mean that a sales
order, expense, journal entry, payment, or current stock balance was posted.
Existing import review and continuation actions remain responsible for that
separate business operation.

## Calendar and metric contract

- Custom dates are inclusive calendar dates in the selected IANA time zone.
  Timestamp filters use `[start, end)`; `end` is the following local midnight.
  This includes the entire final day and avoids double-counting a boundary.
- Calendar presets also include whole local dates. DST changes do not turn a
  calendar day into an assumed 24-hour duration.
- The shared contract accepts a company zone; current hosts without a published
  company-zone read use and display UTC. Source-review dates are date-only
  calendar evidence and never shift with the viewer's browser zone.
- All history has open bounds unless authoritative coverage is supplied.
  It has no invented previous-period comparison. Bounded selections compare
  the preceding equal number of calendar dates.
- A finite chart extent derived from loaded module records describes that chart
  only. It is not a complete archive-coverage claim. Current action queues and
  balances stay current when a historical activity period is selected.
- Sales and Purchasing use order date; CRM and Expenses use the existing
  creation-cohort basis; Reports counts report creation. The shared mapping
  keeps insight calculations and their list drilldowns aligned. Overview order
  trends no longer substitute creation/write time for a missing order date.
- Export provenance retains period, zone, business date field where applicable,
  and exclusive-end semantics. Open bounds are omitted from numeric provenance
  rather than serialized as nonfinite numbers.

## Source-review API

`GET /api/history/source/coverage?companyId=<id>&limit=50`

Coverage totals and year/month counts are SQL aggregates across all authorized
source rows, independent of dataset pagination. Dataset pages contain at most
100 entries. Year/month buckets count an observation once at its start; an
interval is not expanded into invented daily activity. Spans of ten or more
years use year inventory buckets, while custom month/day filters remain usable.

`GET /api/history/source/rows?companyId=<id>&from=2022-01-01&toExclusive=2024-01-01&dateMode=dated&limit=50`

Optional filters include `batchId`, `state`, and date quality (`all`, `dated`,
`undated`, `invalid`). Row pages contain at most 100 entries. Calendar bounds
have no fixed maximum duration. Undated/invalid-only queries do not accept
calendar bounds because those rows have no usable date.

The server derives organization and actor from the session and requires the
same unrestricted organization administration access as source review, plus
current company membership. It revalidates permissions, membership, and
placement before returning data. There is no owner bypass or browser SQL.

Signed continuation cursors bind actor, organization, company, placement,
filters, page size, and an inventory revision snapshot. A changed inventory
returns 409 and requires a fresh first page. Reads use a read-only repeatable
transaction and a statement timeout. Missing storage is an unavailable error,
never a successful empty inventory. The browser keys caches by actor/company
and snapshot and hides old rows during scope or permission revalidation.
Upload, Save for review, review decisions, and undo cancel old reads and reset
the current scope to its first page, so newly saved history appears immediately.

## Date metadata for onboarding

Prepared `lumiere-import-review/v1` items may carry optional `businessDate`
metadata alongside their source fields:

```json
{
  "businessDate": {
    "precision": "interval",
    "from": "2022-06-13",
    "toExclusive": "2022-06-19",
    "raw": "13–18 June 2022"
  }
}
```

Supported precision values are `day`, `month`, `year`, `interval`, `undated`,
and `invalid`. Day/month/year metadata must have exact matching boundaries.
Unknown/invalid dates carry no invented bounds. A daily observation uses the
following day as `toExclusive`; a month/year uses the next month/year boundary.
The metadata is immutable source evidence, not the document's upload time.
Omitting it preserves existing source fingerprints and replay behavior.

For older review documents, the API conservatively recognizes declared date
fields such as `date`, `date_order`, `invoice_date`, `observation_date`, or an
inclusive `period_start`/`period_end` pair (including documented camel-case
aliases). It uses the current proposed value when present. Conflicting date
fields are ambiguous; invalid dates are not normalized into another month.
Unrecognized fields and dates embedded only in labels are not guessed.

The committed farm preflight report places dates on audit-block periods. The
committed 838-row review fixture does not prove that each saved source row has
that metadata. This change makes those rows inspectable even when undated; it
does not silently backfill production dates or convert historical stock/debt
observations into current balances. A future source correction must preserve
the original provenance and use verified original dates.

## Scope and verification

Source inventory covers persisted import-review records. Module charts continue
to use their existing authorized ERP read projections and display that basis.
This is not an as-of stock reconstruction, accounting repost, import execution,
or an assertion that an unrelated operational archive was scanned. Coverage
normalization and snapshot aggregation still scale with the company's saved
history; bounded responses do not imply constant-cost queries for arbitrarily
large row inventories. Timeouts surface as unavailable rather than partial totals.

Regression coverage includes old/pre-epoch dates, multi-decade custom ranges,
DST and skipped calendar dates, exact end boundaries, adaptive buckets, no
all-history baseline, scoped drilldown filtering, source-state and null-value
preservation, pagination/snapshot changes, company/actor changes, and revoked
access. PostgreSQL tests cover more than 1,000 rows and 100 datasets, invalid
calendar inputs, date precision, interval overlap, aggregate completeness, and
company/organization isolation.
