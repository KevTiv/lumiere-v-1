<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Lumiere ERP frontend. PostHog is initialized client-side via `instrumentation-client.ts` (Next.js 15.3+ pattern) and server-side via a singleton `lib/posthog-server.ts`. A reverse proxy is configured in `next.config.mjs` to route PostHog traffic through `/ingest/*`, improving reliability against ad blockers. Event tracking covers the full user lifecycle: authentication, onboarding, CRM pipeline, and core sales operations.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `user_signed_in` | User successfully completed sign-in | `app/(auth)/sign-in/page.tsx` |
| `user_sign_in_failed` | User failed to sign in (wrong credentials or error) | `app/(auth)/sign-in/page.tsx` |
| `user_signed_up` | User successfully registered a new account | `app/(auth)/sign-up/page.tsx` |
| `user_sign_up_failed` | User failed to register (validation error or server error) | `app/(auth)/sign-up/page.tsx` |
| `onboarding_completed` | New organization and tenant were successfully bootstrapped | `app/(auth)/onboarding/page.tsx` |
| `sale_order_created` | A new sale order was created | `app/(modules)/sales/sales-client.tsx` |
| `sale_order_confirmed` | A sale order was confirmed (key revenue trigger) | `app/(modules)/sales/sales-client.tsx` |
| `sale_order_cancelled` | A sale order was cancelled (churn/loss signal) | `app/(modules)/sales/sales-client.tsx` |
| `lead_created` | A new CRM lead was created | `app/(modules)/crm/crm-client.tsx` |
| `opportunity_converted_to_order` | A CRM opportunity was converted to a sale order | `app/(modules)/crm/crm-client.tsx` |
| `helpdesk_ticket_closed` | A helpdesk ticket was closed by a support agent | `app/(modules)/helpdesk/helpdesk-ticket-dialog.tsx` |
| `proposal_analysis_requested` | User triggered AI analysis on a proposal | `app/(modules)/proposals/[id]/workspace-client.tsx` |
| `api_user_signed_up` | Server-side: Sign-up request received successfully | `app/api/auth/signup/route.ts` |
| `api_tenant_bootstrapped` | Server-side: Tenant bootstrap request received | `app/api/bootstrap/tenant/route.ts` |

## Files created / modified

| File | Change |
|---|---|
| `instrumentation-client.ts` | **Created** — Client-side PostHog init (EU host, reverse proxy, exception capture) |
| `lib/posthog-server.ts` | **Created** — Server-side PostHog Node client factory |
| `next.config.mjs` | **Modified** — Added `/ingest/*` reverse proxy rewrites and `skipTrailingSlashRedirect` |
| `.env.local` | **Modified** — Added `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` |
| `package.json` | **Modified** — Added `posthog-js` and `posthog-node` dependencies |

## Next steps

Run `pnpm install` from the repo root to install the PostHog packages:

```bash
pnpm install
```

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/105084/dashboard/662107
- **Signup → Onboarding Conversion Funnel**: https://eu.posthog.com/project/105084/insights/ZCPOzX7z
- **Sign-in Success vs Failure Rate**: https://eu.posthog.com/project/105084/insights/98gpCeQe
- **Sale Order Lifecycle**: https://eu.posthog.com/project/105084/insights/ksgPumSl
- **CRM Opportunity to Sale Order Conversion**: https://eu.posthog.com/project/105084/insights/QuHzi3ry
- **New Signups & Onboardings per Week**: https://eu.posthog.com/project/105084/insights/FUJecvzR

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
