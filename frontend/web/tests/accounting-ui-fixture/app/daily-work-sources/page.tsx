"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createLumiereApiClient,
  LumiereApiProvider,
} from "@lumiere/api-client";
import { ErpSessionProvider, useErpSession } from "@lumiere/erp-session";
import { I18nProvider } from "@lumiere/i18n";
import { RBACProvider } from "@lumiere/ui/lib/rbac-context";
import type { PolicyRule, User } from "@lumiere/ui/lib/rbac-types";
import { DailyWorkSources } from "../../../../components/daily-work-sources";

const identity = "ab".repeat(32);
const api = createLumiereApiClient({ baseUrl: "" });
const user: User = {
  id: identity,
  name: "Fixture reviewer",
  email: "reviewer@example.test",
  roles: [],
  status: "active",
  createdAt: "",
  updatedAt: "",
};
const permissions: PolicyRule[] = ["crm", "subscriptions", "reports"].map(
  (module) => ({
    id: module,
    subject: identity,
    resource: `module:${module}`,
    action: "read",
    effect: "allow",
  }),
);
const billingDenied = permissions.filter(
  (permission) => permission.resource !== "module:subscriptions",
);

function CompanyControl() {
  const { activeCompanyId, setActiveCompanyId } = useErpSession();
  return (
    <button
      type="button"
      onClick={() => setActiveCompanyId?.(activeCompanyId === 11 ? 22 : 11)}
    >
      Switch company
    </button>
  );
}

export default function DailyWorkSourcesFixture() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [billing, setBilling] = useState(true);
  return (
    <LumiereApiProvider client={api}>
      <QueryClientProvider client={client}>
        <I18nProvider language="en">
          <ErpSessionProvider
            value={{
              identity,
              organizationId: 7,
              companyIds: [11, 22],
              connected: true,
            }}
          >
            <RBACProvider
              initialUser={user}
              initialPolicies={billing ? permissions : billingDenied}
            >
              <main className="mx-auto max-w-4xl space-y-4 p-4">
                <CompanyControl />
                <button type="button" onClick={() => setBilling(false)}>
                  Revoke billing
                </button>
                <DailyWorkSources organizationId={7} summary={false} />
              </main>
            </RBACProvider>
          </ErpSessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </LumiereApiProvider>
  );
}
