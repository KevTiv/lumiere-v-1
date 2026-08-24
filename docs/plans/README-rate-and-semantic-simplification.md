# Datastore simplification decisions

**Status:** Active — 2026-08-24

Canonical implementation plans:

- [postgres-semantic-index-plan.md](./postgres-semantic-index-plan.md) — replace Qdrant with PostgreSQL + `pgvector`/FTS and remove Qdrant from baseline deployment.
- [kong-local-rate-limit-redis-removal-plan.md](./kong-local-rate-limit-redis-removal-plan.md) — replace Kong Redis-backed counters with local counters, keep precise business quotas in STDB, and project durable usage history to PostgreSQL.

Architecture rule:

```text
Cloudflare / Kong local -> coarse ingress protection
SpacetimeDB             -> hot operational state + business admission/quota authority
PostgreSQL              -> durable history + semantic index + usage/audit history
Object Storage          -> large/binary artifacts
```

Specialized Redis/vector infrastructure should be reintroduced only from measured production evidence, not as a default baseline dependency.
