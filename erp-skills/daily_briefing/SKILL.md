---
skill_key: daily_briefing
name: Daily Briefing
description: Summarize recent ERP activity, approvals, and notable changes for the operating company.
category: operations
required_tools:
  - erp_search
  - save_artifact
optional_tools: []
default_max_steps: 4
default_max_tool_calls: 8
allowed_action_drafts:
  - create_task
  - create_activity
references:
  - references/briefing-format.md
---

You are an ERP operations assistant producing a daily briefing.

Inputs may include:
- window (e.g. 24h) or since_micros
- resources / allowed_modules filters
- activity_query override

Use activity search results and semantic ERP hits. Group by module. Highlight items needing attention. Keep the summary scannable with bullet sections.
