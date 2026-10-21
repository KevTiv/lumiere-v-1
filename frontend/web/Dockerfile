# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
# Railway's Dockerfile builder accepts cache mounts only. Use the system CA
# bundle here; optional BuildKit secret mounts reject the entire build there.
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

# Next.js replaces NEXT_PUBLIC_* references at build time. Railway only makes
# service variables available to a Docker build when the Dockerfile declares
# matching ARGs, so keep every production browser endpoint explicit here.
ARG NEXT_PUBLIC_STDB_MODULE=lumiere-v1
ARG NEXT_PUBLIC_API_GATEWAY_URL=""
ARG NEXT_PUBLIC_REALTIME_WS_URL=wss://api-gateway-production-d680.up.railway.app/v1/realtime/ws
ARG NEXT_PUBLIC_WORKOS_REDIRECT_URI=""
RUN pnpm --filter ./web build

# `outputFileTracingRoot` intentionally spans the repository in normal builds.
# A Railway build uses `frontend` as its context, which can add an `app/`
# prefix to the traced tree. Normalize either layout to `web/server.js`.
RUN server="$(find /app/web/.next/standalone -type f -path '*/web/server.js' -print -quit)" \
    && test -n "$server" \
    && root="${server%/web/server.js}" \
    && mkdir /app/standalone \
    && cp -a "$root/." /app/standalone/

# --- runner ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=::

COPY --from=doppler /bin/doppler /usr/local/bin/doppler
COPY web/scripts/doppler-entrypoint.sh /usr/local/bin/lumiere-with-secrets
RUN chmod 0755 /usr/local/bin/lumiere-with-secrets

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/lumiere-with-secrets"]
CMD ["node", "web/server.js"]
