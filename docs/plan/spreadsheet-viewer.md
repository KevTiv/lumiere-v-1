# Spreadsheet viewing and source selections

The shared document viewer provides a read-only grid for saved CSV and XLSX files. Documents and ERP attachment entry points retain their existing scope, version, and download checks.

## Processing and access

- CSV previews preserve source strings, including leading zeros and whitespace. Comma, semicolon, and tab separators are detected; ambiguous choices remain visible and can be overridden. BOM-marked UTF-16 is supported. Legacy Windows-1252 requires an explicit viewer choice.
- XLSX previews use the isolated workbook worker in viewer mode. Sheets, sparse cells, merged ranges, cached formula results, and number-format metadata are returned without executing formulas, macros, or external links. Unsupported number formats expose the original value and a warning.
- The metadata, range, and search endpoints authorize the parent document and selected version on every request, including processed-cache hits. Requests and responses bind the document, concrete version, and checksum. The `current` alias supports current-document reads without requiring historical-version access.
- Parsed-workbook caching is bounded and separate from HTTP caching. HTTP responses remain private and uncached. Range reads are bounded; the grid renders only visible rows and columns and retains a bounded tile cache.
- File admission, read-only viewing, assistant evidence, and import preparation retain distinct inspection policies. Admitting a file for viewing does not automatically admit it for AI indexing or ERP import.

## Interaction

The grid supports worksheet selection (hidden sheets are labeled), column resizing, frozen coordinates, keyboard and pointer range selection, clipboard copy, full-cell inspection, worksheet search, and an expanded viewport. Source coordinates do not change when navigating the grid.

CSV parse options can be changed without overwriting the original. Preview failures retain the authorized original download action; authorization or integrity failures clear the preview. Reloads, scope changes, version changes, and unmounts cancel pending reads.

Selection actions retain source version, checksum, worksheet, coordinates, and parsing options. Assistant analysis resolves evidence from authorized server bytes. Import preparation verifies managed originals and preserves the existing review/approval flow before any ERP write.

## Supported limits and intentional exclusions

Existing upload byte limits still apply (CSV 2 MB; XLSX 5 MB). Workbook inspection additionally bounds expanded archive size, cells, sheet count, execution time, and output. These are explicit rejection limits, not silent truncation. A virtualized grid does not imply unlimited workbook admission.

This is not a spreadsheet editor or formula calculation engine. Password-protected and legacy XLS files are not supported. Complex Excel styling, charts, and print layout are not reproduced. Files without a managed document/version identity cannot be opened as a saved document merely by matching their filename.

## Validation

Regression coverage lives in the document-viewer and document-workbook client tests, shared viewer component tests, document-viewer Playwright fixture, workbook extraction tests, file-inspection tests, and spreadsheet backend tests. Browser fixtures use synthetic records; they do not certify deployed authentication or ERP effects.
