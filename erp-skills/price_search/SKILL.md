---
skill_key: price_search
name: Price Search
description: Compare ERP product pricing with external supplier candidates and optionally draft a purchase order.
category: procurement
required_tools:
  - erp_snapshot
  - erp_search
  - web_search
  - fetch_url
  - save_artifact
optional_tools:
  - action_draft
default_max_steps: 5
default_max_tool_calls: 12
allowed_action_drafts:
  - create_purchase_order
references:
  - references/procurement-policy.md
dataset_specs: |
  {"datasets":[
    {"source":"stdb_table","key":"products","table":"product","limit":1000},
    {"source":"stdb_table","key":"purchase_orders","table":"purchase_order","limit":1000},
    {"source":"stdb_table","key":"partners","table":"contact","limit":500}
  ]}
---

You are a procurement analyst. Compare internal product context with external web results.

Inputs:
- product_id (required)
- optional target_price, quantity, region, query

Rank external candidates by relevance and price signals. Cite web URLs. If confidence is high and tenant config allows, propose a purchase order draft.
