# Signed offline category read grants

Status: implementation candidate stacked on category-app PR #140. No production
grant policy is enabled by default. The live API/STDB/Next/Kong/Docker completion
gate remains for the local pass.

## Behavior and contract

`GET /v1/offline/product-categories/grant` uses the existing session, actor,
organization, company, field-permission and deployment checks. It accepts only
company selection and the discovered authorization version, rejects cursors and
rechecks current authority before issuance. Anonymous requests remain 401;
disabled issuance returns authenticated 404. Responses are `no-store`.

The ES256 envelope contains version, algorithm, key ID, base64url payload and a
raw 64-byte P-256 signature. The exact signed message is
`lumiere-offline-category-grant-v1.<keyId>.<payload>`. Claims bind the category
resource, schema hash, deployment ID, exact browser origin, resolved scope
(environment, actor, organization, company, authorization version) and Unix
issue/expiry seconds. Decimal IDs are preserved as strings. Unknown fields,
algorithms, unpinned keys and noncanonical encodings fail closed.

The static reader pins public keys in its build. Only a genuine network error or
server outage can admit saved rows with a valid cached lease. Redirects and live
401/403/409/410 reset admission and clear the active projection. Malformed
responses, invalid requests and cancellation do not admit a cold fallback.
Reconnect discovers live scope before replay; an offline transport cannot sync.
The lease is never sent as a server credential and permits no business writes.

One current signed lease and an observed-clock high-water value are stored in
origin localStorage. Ordinary departure preserves the lease and OPFS rows.
Sign-out, company/scope changes and explicit clear delete admission metadata.
Expiry or observed clock rollback hides rows and closes the view while preserving
saved data. Checks run before rendering, on focus/visibility resume and on a
one-second timer while the page runs. APIs, session responses and grants remain
excluded from the service-worker cache; only public startup assets are cached.

## Explicit operator configuration

All five server settings are required together. Partial or invalid configuration
fails startup; leaving all absent disables issuance.

| Server variable                       | Value                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `LUMIERE_OFFLINE_GRANT_PKCS8_BASE64`  | Secret standard-base64 P-256 PKCS8 DER signing key                                                        |
| `LUMIERE_OFFLINE_GRANT_KEY_ID`        | Public key label, 1–128 ASCII letters/digits/`.`/`_`/`-`                                                  |
| `LUMIERE_OFFLINE_GRANT_DEPLOYMENT_ID` | Deployment label with the same constraints                                                                |
| `LUMIERE_OFFLINE_GRANT_AUDIENCE`      | Exact canonical HTTPS browser origin, no path or trailing slash; localhost HTTP permitted for development |
| `LUMIERE_OFFLINE_GRANT_TTL_SECS`      | Operator-selected integer lifetime, 1–86400 seconds                                                       |

Set `LUMIERE_OFFLINE_GRANT_TRUST` in the **web build environment**, as a JSON
string with this shape (placeholders must be replaced):

```json
{
  "deploymentId": "deployment-label",
  "maximumLifetimeSeconds": 3600,
  "keys": [{ "keyId": "key-label", "publicKey": "BASE64URL_SEC1_POINT" }]
}
```

`3600` is an illustrative policy value, not a default. Choose the permitted
offline duration explicitly; the server TTL must not exceed the build's maximum.
Both enforce a one-day protocol ceiling. The public key is the unpadded
base64url encoding of the 65-byte uncompressed SEC1 P-256 point (`04 || X || Y`),
not PEM/SPKI. A public P-256 JWK's base64url `x` and `y` decode to the two 32-byte
coordinates. The production private key belongs only in the server secret
configuration; never put it in web environment, repository, browser storage or
logs. Test signers and the committed interoperability vector contain no
production credentials.

Build with `pnpm --dir frontend/web build:offline` and deploy all generated
assets together. Turbo hashes `LUMIERE_*`, including this trust configuration.
Pin changes alter the client hash and service-worker cache generation. Keep old
assets available while older readers remain open. With no trust configuration,
the app retains the reconnect-required cold-start behavior.

For rotation, publish builds trusting the new key (up to eight distinct pins),
then switch server issuance to that key ID. Remove old pins in a later build
after their permitted leases have elapsed. An already cached offline build
cannot learn new pins or key revocation without connecting. Changing deployment
or audience requires matching rebuilt clients and rejects previous leases.

## Limits and local completion gate

This is bounded read admission for an ordinary browser profile, not device-bound
access or tamper-resistant time. A hostile local user or injected script can
modify storage, reset the clock high-water value or read unencrypted OPFS files.
Browser timers can pause while a page is frozen. Remote access revocation is
observed on reconnect; it cannot invalidate a physically offline browser before
the lease expires. Do not use this policy where that revocation delay or
unencrypted local data is unacceptable. Persistence consent, encryption/key
management, quota/eviction recovery and all-actor physical erasure remain later
work. This slice adds no generalized resources, ChangeSets or offline writes.

Focused evidence:

- 39 Chromium tests passed together: 18 storage, 11 existing app and 10 grant
  scenarios, using real SQLite WASM/OPFS and an authenticated HTTP fixture.
- 66 offline Node tests and 3 Next rewrite tests passed, including an actual
  Rust-ring signature verified by browser-compatible WebCrypto, tampering,
  exact scope, expiry boundaries, clock rollback, lifecycle invalidation,
  outage classification and build/key rotation.
- Offline/app TypeScript, formatting, frozen pnpm lockfile, i18n keys, browser
  operation transport, Turbo trust-environment invalidation and production
  static-asset build checks passed. Cargo locked offline metadata passed.
- 17 isolated Rust tests passed against the actual grant, core and row sources;
  three exercise signing/configuration. These do not compile the full API or
  execute its authenticated route against live STDB.

On the local machine, configure matching keys/origin/deployment/lifetime and
exercise issuance through actual Next/Kong cookies and STDB field permissions.
Verify anonymous and cross-company denial, policy version mismatch, expiry,
sign-out, reconnect revocation, actor transition, old/new key rotation and a
full offline restart with production assets. Complete full workspace and Docker
build checks there; private contracts prevent a complete install in this
environment. No extra CI job or automatic browser download is added.
