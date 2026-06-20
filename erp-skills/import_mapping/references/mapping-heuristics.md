# Mapping heuristics

- Match column names case-insensitively; prefer exact field name matches.
- Common aliases: email → email, qty/quantity → quantity, sku/code → default_code.
- Flag required ERP fields that remain unmapped.
- Date columns should note expected format (ISO-8601 preferred).
