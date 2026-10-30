#!/usr/bin/env python3
"""Select the real-service guide gate without expanding unrelated PR costs."""

import argparse
import os
import subprocess
from pathlib import Path


EXACT = {
    ".github/workflows/e2e-smoke.yml",
    "scripts/guide-lifecycle-scope.py",
    "scripts/run-guide-lifecycle.mjs",
    "scripts/tests/test-guide-lifecycle.mjs",
    "scripts/tests/test_guide_lifecycle_scope.py",
    "api-server/src/routes/knowledge_guides.rs",
    "ai-gateway/src/routes/guide_retrieval.rs",
    "ai-gateway/src/routes/rag.rs",
    "ai-gateway/src/orchestrator/evidence_inspector.rs",
    "ai-gateway/src/orchestrator/guide_source_authority.rs",
    "ai-gateway/src/orchestrator/guide_source_authority_tests.rs",
    "spacetimedb/src/ai/runtime_reads.rs",
    "spacetimedb/src/documents/knowledge.rs",
    "spacetimedb/src/documents/knowledge_guides.rs",
    "spacetimedb/tests/platform/knowledge_guides_test.rs",
    "api-server/src/query_exec/company_scope.rs",
    "frontend/web/app/(modules)/modules-shell.tsx",
    "frontend/web/lib/erp-ai-context.tsx",
}
PREFIXES = (
    "api-server/src/routes/knowledge_guides/",
    "frontend/web/app/api/knowledge/guides/",
    "frontend/web/app/(modules)/documents/knowledge/",
    "frontend/web/components/assistant-guide",
    "frontend/web/lib/assistant-guide",
    "frontend/packages/ui/src/ai-chat/assistant-guide",
    "frontend/packages/ui/src/ai-chat/guide-verification",
    "frontend/packages/ui/src/lib/assistant-guide",
    "api-server/src/cold_tier/migrate/postgres_compatibility_tests/knowledge_guides",
)


def guide_relevant(paths):
    return any(path in EXACT or path.startswith(PREFIXES) for path in paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--github-output", required=True)
    args = parser.parse_args()
    event = os.environ["EVENT_NAME"]
    if event in {"schedule", "workflow_dispatch"}:
        selected = True
    else:
        base = os.environ["BASE_SHA"]
        head = os.environ["HEAD_SHA"]
        if not base or set(base) == {"0"}:
            command = ["git", "ls-tree", "-r", "--name-only", head]
        else:
            command = ["git", "diff", "--name-only", base, head]
        paths = subprocess.check_output(command, text=True).splitlines()
        selected = guide_relevant(paths)
    with Path(args.github_output).open("a") as output:
        output.write(f"run_guides={'true' if selected else 'false'}\n")


if __name__ == "__main__":
    main()
