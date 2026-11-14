# Try your ChatGPT plan in Lumière locally

This developer prototype runs on macOS or Linux with Node.js 22 or later. It opens your system browser to connect an eligible ChatGPT account and uses that plan for a short, fixed Responses API request. The optional ERP smoke test checks the local product catalog as a Lumière user.

## Run the smoke test

From the checkout on your own machine:

```sh
npm ci --prefix scripts/chatgpt-plan
node scripts/chatgpt-plan/cli.mjs
```

Review the ChatGPT workspace and plan-usage consent in the browser. The terminal prints the answer after the stream completes. The CLI discovers models available to the signed-in account. Pass `--model SLUG` to select one, or `--profile LABEL` to create a separate local registration for another account or workspace. Use lowercase letters, digits, and hyphens in profile labels.

## Include a local product read

Start the local Lumière API server and sign in to a disposable fixture organization as a user with product read access. For the local password-auth stack, use the `stdb_token` from that user's local session. Set the actual organization ID and paste the token at the hidden prompt. It stays in a shell variable only long enough to pass it into the CLI via stdin.

```bash
read -r -s -p "Local Lumière user-session token: " lumiere_actor
printf '\n'
printf '%s\n' "$lumiere_actor" |
  node scripts/chatgpt-plan/cli.mjs --erp-organization 42
unset lumiere_actor
```

The default API port is 8082. Set `--erp-port` if your local API uses a different port. The model can request one parameterless `inventory.has_products` function. The CLI validates the request and calls the existing `GET /v1/query/products` as that actor, with an explicit organization and list limit of one. The API checks actor identity, organization scope, and product permissions. The CLI sends a single boolean to OpenAI and uses the result in a second streamed response. Product names, records, organization IDs, and the Lumière session token stay on the local machine.

This smoke test exercises the local API's read authorization. Production harness execution, run records, provider configuration, hosted OAuth, scheduled runs, and write tools are outside its scope.

## Credentials and usage

Each run asks OpenAI for a fresh authorization code through a loopback callback. ChatGPT access, ID, and refresh tokens are never written to disk. The CLI saves a stable installation ID and each profile's issued client ID and verified subject in owner-only files under `~/.config/lumiere-chatgpt-plan/`. Use [ChatGPT usage settings](https://chatgpt.com/#settings/Usage) to manage app access and allowance. After revoking the app in ChatGPT, delete its local `*.registration.json` file if you want to register that profile again.

The requests originate on your machine and use [OpenAI's documented local sign-in flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [Responses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) under the [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/). A hosted deployment uses its separately configured provider credentials.

## Offline tests

```sh
npm --prefix scripts/chatgpt-plan test
```

The tests use synthetic signed identity tokens and simulated Responses streams and Lumière product results. Live browser authorization and live local ERP access require your own eligible ChatGPT account and fixture stack.
