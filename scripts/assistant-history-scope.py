#!/usr/bin/env python3
"""Select the long-thread test only for Assistant changes and release runs."""

import argparse
import os
import subprocess
from pathlib import Path


EXACT = {
    ".github/workflows/e2e-smoke.yml",
    "ai-gateway/src/orchestrator/intelligence_router.rs",
    "ai-gateway/src/orchestrator/model_configuration.rs",
    "ai-gateway/src/providers/llm.rs",
    "ai-gateway/src/providers/mod.rs",
    "api-server/src/query_exec/ai.rs",
    "api-server/src/query_exec/mod.rs",
    "api-server/src/routes/operations.rs",
    "api-server/src/routes/presentation.rs",
    "api-server/src/routes/presentation/personal_pages.rs",
    "api-server/src/routes/queries.rs",
    "api-server/src/routes/queries/chat_history.rs",
    "api-server/src/routes/mod.rs",
    "api-server/src/cold_tier/migrate.rs",
    "crates/stdb-client/src/chat_history.rs",
    "crates/stdb-client/src/lib.rs",
    "scripts/import-task-prepare.py",
    "scripts/import_preparation.py",
    "frontend/packages/query-hooks/src/assistant-actions.ts",
    "frontend/packages/query-hooks/src/hooks/ai-memory.ts",
    "frontend/packages/ui/src/pages/page-composition.tsx",
    "frontend/web/app/(modules)/modules-shell.tsx",
    "frontend/web/lib/assistant-widget-receipts.ts",
    "frontend/web/lib/module-page-composition.tsx",
    "frontend/web/playwright.assistant-history.config.ts",
    "scripts/assistant-history-scope.py",
    "scripts/run-assistant-history-load.mjs",
}
PREFIXES = (
    "ai-gateway/src/routes/rag",
    "ai-gateway/src/routes/chat_context",
    "api-server/src/cold_tier/ai_chat_context",
    "api-server/src/cold_tier/assistant_chat_",
    "api-server/src/routes/assistant_chat_",
    "api-server/src/routes/chat_context",
    "frontend/packages/stdb/src/commands/ai-chat",
    "frontend/packages/ui/src/ai-chat/",
    "frontend/packages/ui/src/lib/ai-chat",
    "frontend/web/app/api/ai/_lib/",
    "frontend/web/app/api/ai/rag/",
    "frontend/web/app/api/ai/chat/",
    "frontend/web/lib/use-assistant-chat-history",
    "frontend/web/lib/use-assistant-history-references",
    "frontend/web/lib/assistant-history",
    "frontend/web/tests/assistant-history",
    "spacetimedb/src/ai/chat",
)


def history_relevant(paths):
    return any(path in EXACT or path.startswith(PREFIXES) for path in paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-output", type=Path, required=True)
    args = parser.parse_args()
    event = os.environ["EVENT_NAME"]
    if event in {"schedule", "workflow_dispatch"}:
        selected = True
    else:
        base = os.environ["BASE_SHA"]
        head = os.environ["HEAD_SHA"]
        command = (
            ["git", "ls-tree", "-r", "--name-only", head]
            if not base or set(base) == {"0"}
            else ["git", "diff", "--name-only", base, head]
        )
        selected = history_relevant(subprocess.check_output(command, text=True).splitlines())
    with args.github_output.open("a") as output:
        output.write(f"run_assistant_history={'true' if selected else 'false'}\n")


if __name__ == "__main__":
    main()
