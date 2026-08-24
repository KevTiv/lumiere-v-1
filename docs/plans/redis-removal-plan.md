# Redis removal plan

**Status:** Superseded by dedicated implementation plan — 2026-08-24

Use [kong-local-rate-limit-redis-removal-plan.md](./kong-local-rate-limit-redis-removal-plan.md) as the canonical Redis-removal plan.

Current direction:

- Kong uses local counters for coarse ingress protection;
- Cloudflare remains the upstream edge-abuse layer;
- SpacetimeDB owns precise tenant/user/business quotas and admission state;
- PostgreSQL owns durable usage/audit history;
- Redis is removed from the baseline deployment unless a separately verified non-Kong dependency remains;
- do not make Kong synchronously query STDB for every request.
