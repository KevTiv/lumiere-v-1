# Mapping heuristics

- Match column names case-insensitively; prefer exact field name matches.
- Common aliases: email → email, qty/quantity → quantity, sku/code → default_code, company → company_name (leads) or type_=company (contacts).
- Flag required ERP fields that remain unmapped.
- Date columns should note expected format (ISO-8601 preferred).
- Unmapped columns → suggest `metadata.extra.<normalized_header>` rather than dropping data.
- Before mapping, summarize structure: column count, duplicates, empty columns, sample row count.
- Cross-check canonical headers in `spacetimedb/src/data_ops/*_imports.rs` for the target entity.
