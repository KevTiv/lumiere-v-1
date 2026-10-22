FROM dopplerhq/cli:3.75.1@sha256:f2ffb55128ed895ca3ee7a64a394661e89aa16cf9f9e05cea24021a4ba062e75 AS doppler

FROM node:22-bookworm-slim

ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

# Dependencies and generated contracts are already resolved by GitHub Actions.
# Railway only copies the traced Next.js standalone runtime into its image.
COPY --chown=node:node runtime/ ./
COPY --from=doppler /bin/doppler /usr/local/bin/doppler
COPY --chmod=0755 web/doppler-entrypoint.sh /usr/local/bin/lumiere-with-secrets

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/lumiere-with-secrets"]
CMD ["node", "frontend/web/server.js"]
