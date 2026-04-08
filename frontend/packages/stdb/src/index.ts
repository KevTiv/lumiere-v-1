/**
 * SpacetimeDB **WebSocket client** barrel (`DbConnection`, generated bindings, connection + context).
 *
 * For the HTTP gateway stack (Next.js, cookies, `/api/query/*`, `/api/call/*`):
 * - `@lumiere/query-hooks/hooks/*` — React Query hooks (api-server via `LumiereApiProvider`)
 * - `@lumiere/stdb/server` — RSC / `stdbSql` / `serverQuery*`
 * - `@lumiere/stdb/browser-http` — `stdbBrowserCall` / `stdbBrowserQuery` when the provider is mounted
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
