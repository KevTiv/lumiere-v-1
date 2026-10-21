FROM node:22-bookworm-slim

WORKDIR /app
COPY scripts/bootstrap-production-identities.mjs ./scripts/bootstrap-production-identities.mjs
COPY scripts/lib/production-identity-bootstrap.mjs ./scripts/lib/production-identity-bootstrap.mjs
COPY infra/identity-bootstrap/entrypoint.sh /usr/local/bin/lumiere-identity-bootstrap
RUN chmod 0755 /usr/local/bin/lumiere-identity-bootstrap

ENTRYPOINT ["/usr/local/bin/lumiere-identity-bootstrap"]
