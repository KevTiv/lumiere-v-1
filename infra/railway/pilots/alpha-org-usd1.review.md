# Alpha org pilot proposal

Prepared and approved by the user on 2026-10-24. The user approved the exact
tenant, models, published rates, concurrency limits and USD 1 cap. This is not
a provisioned database configuration. No billable call was made.
The JSON SHA-256 is `9497d92cb7f15a4ef2693066a91b9ba05a1668fcde8a82a4261168109e01b958`.
It was staged on Railway ai-gateway with deployment disabled and read back exactly.

- Scope: production organization 1 and company 1, both named Alpha org.
- Budget: USD 1 per UTC calendar month for the dedicated pilot agent. The
  canonical spend ledger reserves cost before dispatch. This is an application
  budget, not an account-wide Mistral spending limit.
- Primary: `mistral-small-2603`, USD 0.15 input / USD 0.60 output per million tokens.
- Review: `mistral-medium-3-5`, USD 1.50 input / USD 7.50 output per million tokens.
- Prices use USD microunits per 1,000 tokens in the JSON: 150/600 and 1500/7500.
- Both roles use a conservative 32,768-token input/output context allowance,
  2,048 output tokens, 60-second timeout, one concurrent request, and no retries.
  The roles use distinct model IDs. No fallback or shadow model is configured.

Pricing and capabilities were checked against the official model pages:
[Mistral Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03) and
[Mistral Medium 3.5](https://docs.mistral.ai/models/mistral-medium-3-5-26-04).
Account model visibility must still pass the read-only catalog check. These
published IDs do not establish account access.

Before database apply: add MISTRAL_API_KEY directly to Railway,
complete a real report_analysis skill certification and independent promotion,
and run the key/catalog check and provisioning preflight. Do not copy credentials
into this manifest. The provisioning script rejects a missing certified release.
Embedding and vision provider settings require separate explicit selection;
this pilot proposal does not change vector collections or embedding spaces.

Offline plan (zero network requests and zero billable calls):

```sh
node scripts/provision-ai-harness.mjs --plan infra/railway/pilots/alpha-org-usd1.json
```
