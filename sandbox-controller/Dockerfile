# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --ignore-scripts --omit=dev; \
    else npm ci --ignore-scripts --omit=dev; fi
COPY --chown=node:node src ./src
COPY --chown=node:node runtime ./runtime
USER node
EXPOSE 8080
CMD ["node", "src/server.mjs"]
