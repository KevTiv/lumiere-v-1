FROM node:22-bookworm-slim

ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

WORKDIR /app

# Dependencies and generated contracts are already resolved by GitHub Actions.
# Railway only copies the traced Next.js standalone runtime into its image.
COPY --chown=node:node runtime/ ./

USER node

EXPOSE 3000

CMD ["node", "frontend/web/server.js"]
