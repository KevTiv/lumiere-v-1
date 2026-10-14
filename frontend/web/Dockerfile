FROM node:22-bookworm-slim AS base
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global pnpm@10.31.0 --strict-ssl=true

# --- deps ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY mobile/package.json ./mobile/
COPY web/package.json ./web/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/erp-session/package.json ./packages/erp-session/
COPY packages/erp-shared/package.json ./packages/erp-shared/
COPY packages/erp-workflows/package.json ./packages/erp-workflows/
COPY packages/presentation-core/package.json ./packages/presentation-core/
COPY packages/query-hooks/package.json ./packages/query-hooks/
COPY packages/stdb/package.json ./packages/stdb/
COPY packages/ui/package.json ./packages/ui/
COPY packages/i18n/package.json ./packages/i18n/
COPY vendor/ ./vendor/
RUN pnpm install --frozen-lockfile

# --- builder ---
FROM deps AS builder
COPY . .
RUN pnpm --filter ./web build

# --- runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/web/.next ./web/.next
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/package.json ./web/package.json
COPY --from=builder /app/web/node_modules ./web/node_modules
COPY --from=builder /app/web/scripts/start-with-contract-check.mjs ./web/scripts/start-with-contract-check.mjs
COPY --from=builder /app/node_modules ./node_modules

WORKDIR /app/web
EXPOSE 3000

CMD ["node", "./scripts/start-with-contract-check.mjs"]
