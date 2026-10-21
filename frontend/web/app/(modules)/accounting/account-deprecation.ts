import { optionalBigIntU64 } from '@lumiere/erp-shared/form-coercion';

type Row = Record<string, unknown>;

/** True when the chart-of-accounts row is deprecated (hidden from new postings). */
export function accountIsDeprecated(account: Row): boolean {
  return account.deprecated === true;
}

/**
 * `deprecate_account_account` (account_account:write) flips the flag either way, so the row action
 * toggles it: deprecate an active account, reactivate a deprecated one.
 */
export function deprecateAccountParams(
  account: Row,
  fallbackCompanyId: bigint,
): { companyId: bigint; deprecated: boolean } | null {
  // The reducer requires the account to belong to the named company, so prefer the row's own.
  const companyId = optionalBigIntU64(account.companyId ?? account.company_id) ?? (fallbackCompanyId > 0n ? fallbackCompanyId : null);
  if (companyId == null) return null;
  return { companyId, deprecated: !accountIsDeprecated(account) };
}
