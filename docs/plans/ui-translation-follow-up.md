# UI translation follow-up

The Alpha change covers Finance, its support screens, authentication, and shared controls. It makes built-in wording available through translation keys. New feature text uses the configured English fallback until its locale pack supplies a translation. New mandatory core labels are also supplied in French, Kinyarwanda, and Swahili.

## Remaining source scope

Prepare the next PR for text outside the `finance-alpha` profile:

- Inventory, distribution, manufacturing, HR, projects, and workflow administration.
- Fleet, IoT, map, helpdesk, POS, proposals, AI administration, and presentation preview.
- Their built-in dashboards, entity configurations, form configurations, status labels, and helper messages.
- Mobile application text. Remove unused Expo starter screens before translating the retained interface.

Keep stable command IDs, enum values, CSV import headers, field keys, permission tokens, URLs, and user-authored content unchanged. Built-in option labels and status labels need keys; their stored values do not.

## Audit command

From `frontend`, run:

```sh
pnpm i18n:audit-ui
pnpm i18n:audit-ui --json > /tmp/lumiere-ui-text-audit.json
```

The command reports direct JSX text, UI attributes, configuration properties, and message calls. Each JSON row includes its file, line, text, category, and exact English catalog matches. It excludes tests, generated bindings, development routes, locale files, and console calls.

Hits are candidates for review. They include names, codes, sample content, language endonyms, and technical examples that can be intentional. The command does not prove tenant access or runtime reachability. Trace helper outputs, default arguments, status maps, and errors supplied by other packages where the scan cannot determine the display path.

## Implementation and verification

1. Reuse an existing key when its meaning matches. Give new keys a module or shared-component namespace.
2. Use complete interpolated messages and i18next plural forms. Avoid assembling translated sentence fragments.
3. Resolve labels at render time or through a translated factory. Static configuration getters can preserve the existing API, but memoized spreads must refresh when the language changes.
4. Preserve stored document text, reviewed message content, report definitions, and import/export contracts.
5. Run `pnpm i18n:check`, UI and web type checks, and the affected UI/model tests. Add language-switch tests where configuration is cached.

## Separate locale-pack completion

Catalog extraction and full language coverage are separate work. `pnpm i18n:coverage` reports supplied pack keys without counting English fallback as translated. Complete the remaining French, Kinyarwanda, and Swahili feature entries through language review. Keep the Kinyarwanda loanword overrides in sync with `pnpm i18n:loanwords`.

Server-provided error text, generated document content, and tenant-defined form labels also need separate ownership review. Do not replace tenant content with global UI keys.
