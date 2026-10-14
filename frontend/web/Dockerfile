FROM node:22-bookworm-slim AS base
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    npm install --global pnpm@10.31.0 --strict-ssl=true

FROM dopplerhq/cli:3.75.1@sha256:f2ffb55128ed895ca3ee7a64a394661e89aa16cf9f9e05cea24021a4ba062e75 AS doppler

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
COPY scripts/verify-vendored-contracts.mjs ./scripts/verify-vendored-contracts.mjs
RUN node ./scripts/verify-vendored-contracts.mjs
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
COPY --from=builder /app/node_modules ./node_modules
COPY --from=doppler /bin/doppler /usr/local/bin/doppler
COPY web/scripts/doppler-entrypoint.sh /usr/local/bin/lumiere-with-secrets
RUN chmod 0755 /usr/local/bin/lumiere-with-secrets

WORKDIR /app/web
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/lumiere-with-secrets"]
CMD ["./node_modules/.bin/next", "start"]
