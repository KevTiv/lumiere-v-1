# Fix Plan: `company_id IN (...)` SQL Pattern in `api-server/src/query_exec.rs`

**Status:** Not started — pickup ready
**Impact:** ~1210 ERROR log lines per E2E run → 0; HTTP 500 on AI/intercompany/asset/POS screens
**Root cause:** SpacetimeDB's HTTP SQL subset does not support `IN (...)` clauses. The api-server uses `company_id IN (12, 13)` to scope queries for tables that are company-scoped, causing every such query to fail with HTTP 400 "Unsupported".

---

## Problem Architecture

```
Client (React Query)
  → /api/query/{resource}
    → api-server query_exec.rs
      → SpacetimeDB HTTP SQL: "SELECT ... FROM table WHERE company_id IN (12, 13)"
        → HTTP 400 "Unsupported" (SpacetimeDB SQL doesn't support IN)
          → HTTP 500 to client
```

The `company_ids_for_organization()` helper (line 16) fetches all company IDs for an org, then builds `company_id IN (id1, id2, ...)` SQL. SpacetimeDB rejects this.

## Two Distinct Error Categories in the Logs

### Category A — `company_id IN (...)` pattern (the IN-clause failure)

These query branches in `query_exec.rs` build `IN` clauses that SpacetimeDB rejects:

| # | Resource key | Table | Line (approx) | Current SQL pattern | Has `organization_id`? |
|---|---|---|---|---|---|
| 1 | `ai-action-drafts-inbox` | `ai_action_draft` | ~163 | `WHERE organization_id = {org} AND company_id IN ({list}) AND status = 'pending'` | ✅ Yes |
| 2 | `account-assets` / `fixed-assets` | `account_asset` | ~254 | `WHERE company_id IN ({list})` | ❌ No |
| 3 | `depreciation-lines` | `account_asset_depreciation_line` | ~274 | subquery: `SELECT id FROM account_asset WHERE company_id IN ({list})` | ❌ No (parent table) |
| 4 | `intercompany-rules` | `intercompany_rule` | ~322 | `WHERE source_company_id IN ({list}) OR destination_company_id IN ({list})` | ❌ No |
| 5 | `intercompany-transactions` | `intercompany_transaction` | ~343 | `WHERE origin_company_id IN ({list}) OR destination_company_id IN ({list})` | ❌ No |
| 6 | `pos-configs` | `pos_config` | ~363 | `WHERE company_id IN ({list}) ORDER BY name ASC` | ❌ No |
| 7 | `pos-sessions` | `pos_session` | ~383 | subquery: `SELECT id FROM pos_config WHERE company_id IN ({list})` | ❌ No (parent table) |
| 8 | `ai-insights` | `ai_insight` | ~432 | `WHERE company_id IN ({list}) OR company_id IS NULL` | ❌ No |
| 9 | `ai-document-processing-jobs` | `ai_document_processing_job` | ~457 | `WHERE company_id IN ({list}) OR company_id IS NULL` | ❌ No |

### Category B — "Unsupported" errors on `WHERE organization_id = ?` queries (separate issue)

These tables already use `select_org_scoped_sql` (the default path at line ~576) but SpacetimeDB SQL still returns "Unsupported". This is NOT caused by `IN` clauses — it's caused by SpacetimeDB SQL not supporting certain column types (likely `Vec<T>` / array columns) in the SELECT list.

| Table | Example failing SQL | Likely cause |
|---|---|---|
| `pos_loyalty_program` | `SELECT ... trigger_product_ids, rule_ids, reward_ids, communication_plan_ids ... FROM pos_loyalty_program WHERE organization_id = 18` | Array columns (`trigger_product_ids`, `rule_ids`, etc.) |
| `quality_alert` | `SELECT ... tag_ids, activity_ids, message_ids ... FROM quality_alert WHERE organization_id = 18` | Array columns (`tag_ids`, `activity_ids`, `message_ids`) |
| `contact_tag` | `SELECT id, organization_id, name, color, description, created_at, metadata FROM contact_tag WHERE organization_id = 18 ORDER BY name ASC` | Unknown — possibly `metadata` or `ORDER BY` |
| `activity` | `SELECT ... FROM activity WHERE organization_id = 18 ORDER BY id DESC` | Unknown — many columns |
| `opp_stage` | `SELECT ... requirements ... FROM opp_stage WHERE organization_id = 18 ORDER BY sequence ASC` | Possibly `requirements` field |
| `contact_segment` | `SELECT ... domain ... FROM contact_segment WHERE organization_id = 18 ORDER BY name ASC` | Possibly `domain` field |

**This plan focuses on Category A.** Category B should be a separate investigation.

---

## Fix Tracks

### Track 1 — Quick win: tables that already have `organization_id`

**Only 1 table:** `ai_action_draft` (resource `ai-action-drafts-inbox`)

The query already filters by `organization_id = {org_id}` AND `company_id IN ({list})`. Since the table has `organization_id`, the `company_id IN` clause is redundant for org-level scoping.

**Fix:** Drop the `company_id IN` clause, keep `WHERE organization_id = {org_id} AND status = 'pending'`.

```rust
// BEFORE (line ~163):
let sql = format!(
    "SELECT ... FROM ai_action_draft WHERE organization_id = {organization_id} AND company_id IN ({company_filter}) AND status = 'pending' ORDER BY id DESC"
);

// AFTER:
let sql = format!(
    "SELECT ... FROM ai_action_draft WHERE organization_id = {organization_id} AND status = 'pending' ORDER BY id DESC"
);
```

Remove the `company_ids_for_organization` call for this branch.

---

### Track 2 — Tables WITHOUT `organization_id`: Rust-side filtering

**6 tables:** `account_asset`, `intercompany_rule`, `intercompany_transaction`, `pos_config`, `ai_insight`, `ai_document_processing_job`

These tables don't have `organization_id` in their SpacetimeDB schema (confirmed in `stdb-generated-sql-columns.json` and `resource_registry.json`). Two options:

#### Option 2a — Rust-side filter (no backend change, recommended for speed)

Fetch all rows with a simple SQL query (no WHERE, or `WHERE company_id IS NOT NULL`), then filter in Rust using the company IDs list.

```rust
// Pattern for each affected table:
let company_ids = company_ids_for_organization(client, organization_id, fa).await?;
let company_id_set: std::collections::HashSet<u64> = company_ids.iter().copied().collect();

let col = resolve_http_sql_columns(resource, fa).map_err(ApiError::Internal)?;
// No WHERE clause — fetch all, filter in Rust
let sql = format!("SELECT {} FROM {table}", col.join(", "));
let mut rows = client.query_sql(&sql).await.map_err(|e| ApiError::Internal(e.to_string()))?;

// Filter by company_id membership in Rust
rows.retain(|r| {
    let cid = r.get("companyId")
        .or_else(|| r.get("company_id"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    company_id_set.contains(&cid)
});
```

**Pros:** No SpacetimeDB module change, no republish, immediate fix.
**Cons:** Fetches all rows from the table (fine for small tables, bad for large ones like `ai_document_processing_job` if it grows).

**Tables where this is safe (small row counts):**
- `intercompany_rule` — typically <100 rows per org
- `intercompany_transaction` — moderate, but bounded
- `pos_config` — typically <10 per org
- `ai_insight` — could grow, but has `company_id IS NULL` fallback for org-level insights
- `ai_document_processing_job` — could grow, may need pagination later

**Tables where this is risky (potentially large):**
- `account_asset` — could have thousands of rows across all orgs

For `account_asset`, consider Option 2b instead.

#### Option 2b — Add `organization_id` to SpacetimeDB module (long-term fix)

Add `organization_id: u64` to these table definitions in the Rust module, populate it in reducers, then use `WHERE organization_id = ?`.

**Files to change:**
- `spacetimedb/src/accounting/fixed_assets.rs` — add `organization_id` to `AccountAsset` table
- `spacetimedb/src/accounting/intercompany.rs` — add `organization_id` to `IntercompanyRule` and `IntercompanyTransaction`
- `spacetimedb/src/pos/pos_config.rs` (or equivalent) — add `organization_id` to `PosConfig`
- `spacetimedb/src/ai/intelligence.rs` (or equivalent) — add `organization_id` to `AiInsight` and `AiDocumentProcessingJob`

**Migration steps:**
1. Add `organization_id` field to each table struct
2. Update all reducer `insert()` calls to populate `organization_id`
3. Run `spacetime publish --clear-database` (destructive — dev only)
4. Regenerate bindings: `spacetime generate`
5. Update `stdb-generated-sql-columns.json` and `resource_registry.json`
6. Update `query_exec.rs` to use `select_org_scoped_sql` for these tables

**This is the correct long-term fix but requires a full backend republish and data reseed.**

---

### Track 3 — Dependent subqueries (depreciation-lines, pos-sessions)

These branches use `company_id IN` in a subquery to find parent IDs, then query the child table.

#### `depreciation-lines` (line ~274)

```rust
// Current: subquery uses IN to find asset IDs
"SELECT id FROM account_asset WHERE company_id IN ({list})"
// then: SELECT ... FROM account_asset_depreciation_line WHERE asset_id IN ({asset_ids})"
```

The `IN` appears twice — once for company_id, once for asset_id. Both are unsupported.

**Fix (Option 2a):** Fetch all `account_asset` rows, filter by company_id in Rust, extract asset IDs, then fetch all depreciation lines and filter by asset_id in Rust.

```rust
let company_ids = company_ids_for_organization(client, organization_id, fa).await?;
let company_set: HashSet<u64> = company_ids.iter().copied().collect();

// Fetch all assets, filter in Rust
let asset_rows = client.query_sql("SELECT id, company_id FROM account_asset").await?;
let asset_ids: Vec<u64> = asset_rows.iter()
    .filter(|r| {
        let cid = r.get("company_id").and_then(|v| v.as_u64()).unwrap_or(0);
        company_set.contains(&cid)
    })
    .filter_map(|r| r.get("id").and_then(|v| v.as_u64()))
    .collect();

if asset_ids.is_empty() { return Ok(vec![]); }

// Fetch all depreciation lines, filter by asset_id in Rust
let asset_set: HashSet<u64> = asset_ids.into_iter().collect();
let col = resolve_http_sql_columns("depreciation-lines", fa)?;
let sql = format!("SELECT {} FROM account_asset_depreciation_line", col.join(", "));
let mut rows = client.query_sql(&sql).await?;
rows.retain(|r| {
    r.get("assetId").or_else(|| r.get("asset_id"))
        .and_then(|v| v.as_u64())
        .map_or(false, |id| asset_set.contains(&id))
});
```

#### `pos-sessions` (line ~383)

Same pattern — subquery finds `pos_config` IDs by company, then filters sessions by `config_id IN (...)`.

**Fix:** Same approach — fetch all `pos_config` rows, filter by company_id in Rust, extract config IDs, fetch all sessions, filter by config_id in Rust.

---

## Implementation Order

| Step | Track | Effort | Risk | Description |
|------|-------|--------|------|-------------|
| 1 | Track 1 | Trivial | None | Drop `company_id IN` from `ai-action-drafts-inbox` branch — table already has `organization_id` |
| 2 | Track 2a | Small | Low | Rust-side filter for `intercompany-rules` and `intercompany-transactions` (small tables, `source_company_id`/`destination_company_id` patterns) |
| 3 | Track 2a | Small | Low | Rust-side filter for `pos-configs` (small table) |
| 4 | Track 2a | Small | Low | Rust-side filter for `ai-insights` and `ai-document-processing-jobs` (include `company_id IS NULL` rows for org-level insights) |
| 5 | Track 3 | Medium | Low | Rust-side filter for `depreciation-lines` (two-level IN: company→asset→dep_line) |
| 6 | Track 3 | Medium | Low | Rust-side filter for `pos-sessions` (two-level IN: company→config→session) |
| 7 | Track 2a | Medium | Medium | Rust-side filter for `account-assets` / `fixed-assets` (potentially large table — consider adding `LIMIT` or switching to Track 2b) |
| 8 | Cleanup | Trivial | None | Remove `company_ids_for_organization` calls from all converted branches. Consider whether the helper can be deleted entirely (check other call sites). |

**Recommended PR split:**
- PR 1: Steps 1-4 (low risk, high impact — fixes 6 of 9 branches)
- PR 2: Steps 5-7 (medium risk — fixes remaining 3 branches with subqueries and large tables)

---

## Helper Refactor (optional, reduces boilerplate)

If Track 2a is applied to multiple branches, extract a helper:

```rust
/// Fetch all rows from a table and filter by company_id membership in Rust.
/// Used for tables where SpacetimeDB SQL doesn't support `IN` clauses.
async fn select_all_and_filter_by_company(
    client: &StdbClient,
    resource_key: &str,
    table: &str,
    organization_id: u64,
    fa: Option<&FieldAccessContext>,
    company_id_field: &str,       // "company_id" or "source_company_id" etc.
    order_by: &str,
) -> Result<Vec<Value>, ApiError> {
    let company_ids = company_ids_for_organization(client, organization_id, fa).await?;
    if company_ids.is_empty() {
        return Ok(vec![]);
    }
    let company_set: std::collections::HashSet<u64> = company_ids.iter().copied().collect();

    let cols = resolve_http_sql_columns(resource_key, fa).map_err(ApiError::Internal)?;
    let sql = format!("SELECT {} FROM {}{}", cols.join(", "), table, order_by);
    let mut rows = client
        .query_sql(&sql)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    rows.retain(|r| {
        let cid = r.get(company_id_field)
            .and_then(|v| v.as_u64())
            .or_else(|| {
                // Try camelCase variant
                let camel = company_id_field.replace('_', "_"); // SpacetimeDB returns camelCase
                r.get(&camel).and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
        company_set.contains(&cid)
    });

    Ok(rows)
}
```

For tables with dual-company fields (`intercompany_rule` with `source_company_id` + `destination_company_id`), the retain closure needs to check both:

```rust
rows.retain(|r| {
    let src = r.get("sourceCompanyId").or_else(|| r.get("source_company_id")).and_then(|v| v.as_u64()).unwrap_or(0);
    let dst = r.get("destinationCompanyId").or_else(|| r.get("destination_company_id")).and_then(|v| v.as_u64()).unwrap_or(0);
    company_set.contains(&src) || company_set.contains(&dst)
});
```

---

## Verification

1. **Check api-server logs:** After the fix, grep for `company_id IN` in the logs — should be 0 hits.
2. **Check error count:** The 1210 ERROR lines should drop to near 0 (Category B "Unsupported" errors will remain until separately addressed).
3. **Manual smoke test:** Navigate to each affected screen in the UI and verify data loads:
   - AI Insights page
   - AI Document Processing Jobs page
   - Intercompany Rules page
   - Intercompany Transactions page
   - Fixed Assets page
   - Depreciation Lines page
   - POS Configs page
   - POS Sessions page
   - AI Action Drafts inbox
4. **E2E test:** Run `make e2e-smoke` and check for HTTP 500 errors in the api-server log.

---

## Related Issue — Category B "Unsupported" Errors

Separately from the `company_id IN` pattern, several tables fail with "Unsupported" even when using `WHERE organization_id = ?`. This appears to be caused by SpacetimeDB SQL not supporting certain column types (likely `Vec<T>` array columns) in the SELECT list.

**Affected tables:** `pos_loyalty_program`, `quality_alert`, `contact_tag`, `activity`, `contact_segment`, `opp_stage`

**Investigation needed:**
1. Check which columns in each table are `Vec<T>` or complex types in the SpacetimeDB module
2. Test whether excluding those columns from the SELECT list fixes the "Unsupported" error
3. If so, add a column exclusion mechanism to `resolve_http_sql_columns` or the resource registry
4. Alternatively, these tables may need to be fetched via SpacetimeDB subscriptions instead of SQL queries
