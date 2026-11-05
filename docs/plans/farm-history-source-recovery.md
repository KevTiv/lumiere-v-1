# Recovering additional farm source observations

This extends [farm history preparation](farm-history-organization-import.md).
It prepares review evidence; it does not post transactions or change live stock,
receivables, product prices, employee contracts, or payment status.

## Preparation and coverage

Run against the original CSV exports, with private output outside the repository:

```bash
python3 scripts/farm-history-preflight.py '<CSV-folder>' '<private-output-folder>'
```

The output now includes:

| Output | Purpose |
| --- | --- |
| `additional-observations.json` | Expense, settlement, transfer and unknown notes after product sections, retaining every original cell and source coordinates |
| `additional-source-reviews/*.json` | Bounded `lumiere-import-review/v1` documents accepted by the existing source-review workspace |
| `source-coverage.json` | A disposition for every CSV record, including blank records, summaries, exact copies, unclassified rows and rows requiring a smaller selected section |
| `alias-proposals.json` | Proposed spelling groups and ambiguous product labels; no automatic merge, quantity conversion or price update |

Every populated source row must have an explained disposition before calling the
recovery complete. Unclassified rows still need inspection. Exact complete
report copies share observations; matching product lines with different tails
retain their distinct supplementary observations. Output is deterministic for
the same files. Rerunning removes only this command's numbered generated review
documents, keeping unrelated operator files.

An audit spanning more than 62 days is suspicious for this daily/weekly/monthly
report format. Its period remains unknown. A neighbouring report may support a
proposed year correction, which is never applied automatically. This rule does
not cap arbitrary date ranges elsewhere in the ERP.

Known English, French and Kinyarwanda phrases produce explainable suggestions.
For example, `PAYEMENT CHEQ`, `CREDIT`, `MOMO HQ`, `UBUKODE` and
`INKOKO ZIFITE IKIBAZO` retain their wording. They do not establish settlement,
today's debt, a supplier identity, a stock write-off, or a weight conversion.
Unknown wording remains available for human review. Multiple numeric cells leave
the proposed amount unresolved. Review text is split by UTF-8 byte budgets;
oversized rows remain archived and explicitly flagged for section selection.

## Review and use

The app upload preparation uses the same supplementary-row interpreter as this
command. It keeps every original row, and adds proposals only in preparation
mode. Inspection-only mode retains evidence without those proposals.

1. Open original reports in Documents. The document admission profile accepts
   bounded CSV records with blank headings and repeated sections. Every cell is
   inspected, including tail notes. Native CSV imports still require a flat
   header and valid row shape. Instruction-like content still withholds AI use.
2. Select the correct operating company. Load each additional review document
   through Settings → Data import's existing saved source-review workflow.
   Check current saved batches before loading a changed preparation package.
   Identical datasets use existing content-hash admission; changed packages do
   not automatically supersede or reconcile earlier batches.
3. Confirm only known values with supporting evidence. Use partial confirmation
   when identity, dates, category, quantity units or payment status remain open.
4. Follow **View confirmed historical facts**, or **Historical source facts**
   from Sales, Expenses, Warehouse or Accounting. The company-scoped history
   filter includes partially confirmed rows and hides their unconfirmed current
   values. Original wording, dates and row labels remain context. Excluded rows
   are omitted. Coverage totals continue to describe the complete source set.
5. Create native business documents only after resolving their required domain
   facts and reconciling source totals. Historical observations alone are not a
   posted ledger or an assertion of present-day inventory and debt.

## Acceptance after deployment

Reopen an archived multi-section report; rerun preparation against its original
bytes; reconcile coverage and additional observations; load the new review
documents; confirm a subset of one row; verify only those values appear as
confirmed. Check snapshot date aliases such as `as_of` and `count_date`, company
switching, excluded rows, long unreviewed runs between confirmed rows, and an
identical retry. Preserve existing saved decisions and original archives.

No original tenant CSV bytes or live reimport are included in this code change.
The hosted recovery must be checked after deployment before claiming that the
remaining business data has been onboarded.
