export default {
  devIndicators: false,
  // Keep the routes compiled by Playwright's warmup available throughout the suite.
  onDemandEntries: { maxInactiveAge: 15 * 60_000 },
  transpilePackages: ["@lumiere/ui", "@lumiere/i18n", "@lumiere/query-hooks", "@lumiere/erp-session", "@lumiere/erp-shared", "@lumiere/stdb"],
  experimental: { externalDir: true },
}
