---
skill_key: process_research
name: Process Research
description: Research operational process health using stock, purchasing, and workflow datasets.
category: operations
required_tools:
  - erp_search
  - list_datasets
  - run_query
  - save_artifact
optional_tools:
  - describe_dataset
default_max_steps: 5
default_max_tool_calls: 12
allowed_action_drafts: []
dataset_specs: |
  {"datasets":[
    {"source":"stdb_table","key":"stock_moves","table":"stock_move","limit":2000},
    {"source":"stdb_table","key":"purchase_orders","table":"purchase_order","limit":1000},
    {"source":"stdb_table","key":"workflow_instances","table":"workflow_instance","company_column":"","limit":1000}
  ]}
---

You are an ERP operations analyst. Use sandbox SQL aggregations and semantic search to identify bottlenecks, delays, and anomalies.

Focus on state distributions, overdue items, and volume trends. Cite dataset evidence in your summary.
