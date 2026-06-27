# SpacetimeDB import targets (reference)

Import reducers live in `spacetimedb/src/data_ops/`. Each reducer:

- Parses CSV with lowercase header names at import time
- Creates an `ImportJob` and row-level `ImportJobError` records
- Accepts optional `metadata` JSON on many entities

## Common columns

| Entity | Required | Common optional fields |
|--------|----------|------------------------|
| `contact` | `name` | `email`, `phone`, `type_`, `city`, `country_code`, `is_customer`, `is_vendor`, `metadata` |
| `lead` | `name` | `email`, `phone`, `company_name`, `metadata` |
| `opportunity` | `name` | `partner_id`, `expected_revenue`, `metadata` |
| `product` | `name` | `default_code`, `list_price`, `active`, `metadata` |
| `sale_order` | `partner_id` | `client_order_ref`, `amount_total`, `state`, `metadata` |
| `project_task` | `name` | `priority`, `planned_hours`, `metadata` |

## Investigation checklist

1. Open the reducer file (e.g. `crm_imports.rs`, `inventory_imports.rs`).
2. List every `col(&headers, row, "...")` field name — these are canonical CSV headers.
3. Note `required` checks and `parse_bool` / numeric coercions.
4. Compare user CSV headers to canonical names; propose aliases in the mapping step.
5. Put non-canonical columns into `metadata` rather than dropping data.

## Import job metadata

After a successful assisted import, recommend storing:

- `ai_assisted: true`
- `column_mapping: { ... }`
- `gateway_request_id` or skill run id
- `source_path` or original filename

This enables repeat imports and template save in a later phase.
