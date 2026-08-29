# Lumiere mobile

Expo client for Lumiere's mobile surfaces.

## Data and authentication boundary

End-user mobile code reads and mutates ERP data through `@lumiere/api-client` and the configured Lumiere API origin. It must not open direct SpacetimeDB connections or materialize complete table rows: tenant, company, resource, and field authorization remain server-owned.

Set `EXPO_PUBLIC_LUMIERE_API_URL` to the reachable Next.js/API origin, for example `http://192.168.1.2:3000` during local device development. Install the authenticated API bearer with `setBearerToken`; native builds store it in Expo SecureStore. The web target uses AsyncStorage for development only.

The mobile ESLint configuration rejects `@lumiere/stdb` imports, and the workspace typecheck includes this package.

## Development

From `frontend/`:

```bash
pnpm --filter mobile start
pnpm --filter mobile lint
pnpm --filter mobile typecheck
```
