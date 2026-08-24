# Qdrant semantic-index cleanup plan — superseded

**Status:** Superseded — 2026-08-24

This plan is retained only as an architecture-history marker.

The decision to keep Qdrant as Lumière's derived semantic index has been replaced by [postgres-semantic-index-plan.md](./postgres-semantic-index-plan.md).

Current direction:

- do not provision Qdrant in the baseline production topology;
- use PostgreSQL + `pgvector` for semantic vector retrieval;
- combine vector search with PostgreSQL full-text search and relational filtering;
- keep semantic-index data derived and rebuildable;
- keep STDB/Postgres authoritative for business/session/artifact state according to the existing authority split;
- migrate/remove existing Qdrant AI-gateway code, configuration, compose services, health checks and deployment dependencies;
- reconsider a dedicated vector database only after measured production evidence shows Postgres is insufficient.

Do not implement new work from the older Qdrant-specific design. All active semantic-index implementation work should follow the Postgres replacement plan.
