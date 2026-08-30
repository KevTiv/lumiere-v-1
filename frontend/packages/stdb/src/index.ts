/**
 * SpacetimeDB **WebSocket client** barrel (`DbConnection`, generated bindings, connection + context).
 *
 * **Contract surface (preferred for new code):**
 * - `@lumiere/stdb/commands` — typed reducer wrappers + metadata
 * - `@lumiere/stdb/subscriptions` — named subscription intents
 * - `@lumiere/stdb/read-models` — pure UI projections
 * - `@lumiere/stdb/types` — re-exports of generated params (avoid `@lumiere/stdb/generated/*` outside this package)
 *
 * `./generated/**` here is a handful of thin proxy files, not the real
 * generated content — that lives in the private `@lumiere/contracts`
 * package (`packages/contracts` in `KevTiv/lumiere-contracts`), published
 * from `lumiere-v-1` by `make publish-contracts`. The proxies exist only so
 * existing `@lumiere/stdb/generated/*` import specifiers keep working; new
 * code should import from `@lumiere/contracts/generated/*` directly instead.
 *
 * For the HTTP gateway stack (Next.js, cookies, `/api/query/*`, `/api/operations/*`):
 * - `@lumiere/query-hooks/hooks/*` — React Query hooks (api-server via `LumiereApiProvider`)
 * - `@lumiere/stdb/server` — `stdbSql` + entity types for Next.js API routes (not RSC reads)
 * - `@lumiere/stdb/browser-http` — immutable `stdbBrowserCommand`, explicit compatibility calls, and queries
 * - `@lumiere/stdb/client-ui-bridge` — minimal mutation helpers for `@lumiere/ui`
 *
 * Web: realtime invalidation uses `@lumiere/query-hooks/hooks/realtime` (`useLumiereRealtime`); optional native `StdbConnectionProvider` + `createClientSubscriptions` for non-web or legacy.
 * Mobile / embedded clients that use `DbConnection` continue to import from this package.
 */
export * from './generated';
export * from './connection';
export * from './context';
export * from './queries/auth';
export * from './queries/erp-subscriptions';
export * from './warehouse-3d-types';
export {
  createStdbSdk,
  type CreateAccountInput,
  type StdbCompanyId,
  type StdbSdk,
} from './sdk';

/** Form config enums / structs live in `generated/types.ts`, not the SpacetimeDB `generated/index` barrel. */
export { FieldType, FieldWidth, FieldOption, FieldValidation } from './generated/types';

export type {
  CreateActivityParams,
  CreateJobPositionParams,
  CreateReportTemplateParams,
  CreateScheduledReportParams,
  CloseSubscriptionParams,
  CreateDeferredRevenueScheduleParams,
  CreateRevenueRecognitionRuleParams,
  CreateSubscriptionFromSaleOrderParams,
  CreateSubscriptionPlanParams,
  GenerateSubscriptionInvoiceParams,
  RecognizeDeferredRevenueParams,
  AccountMoveLine,
  CreateAccountBankStatementParams,
  CreateAccountTaxParams,
  CreateAccountJournalParams,
  CreateAnalyticAccountParams,
  CreateAnalyticLineParams,
  CreateAnalyticDistributionModelParams,
  UpdateAnalyticAccountParams,
  UpdateAnalyticLineParams,
  UpdateAnalyticDistributionModelParams,
  ConvertLeadParams,
  ConvertOpportunityParams,
  CreatePartnerBankParams,
  UpdatePartnerBankParams,
  CreateDeliveryCarrierParams,
  CreateDeliveryPriceRuleParams,
  CreateLoyaltyProgramParams,
  CreatePaymentMethodParams,
  CreateShippingMethodParams,
} from './generated/types';
