FROM node:22-bookworm-slim
WORKDIR /app
COPY scripts/provision-ai-harness.mjs ./scripts/provision-ai-harness.mjs
# A private, explicitly deployed one-shot setup job. It makes no provider call.
CMD ["node", "scripts/provision-ai-harness.mjs", "--apply", "--env"]
