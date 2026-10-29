# Response shape example

Synthetic teaching example; it is not evidence for a live run. Replace every
identity and fact with the current recorded observation. Do not copy fixture IDs.
The finance example requires the owner preview with totalOpen=16500, scale=2 and
currencyId=1; it does not establish a currency code or current live balance.

```json
{
  "content": "The supplier-payables preview records 16500 minor units at scale 2 in currency ID 1.",
  "citations": [],
  "claims": [
    {
      "text": "The supplier-payables preview records 16500 minor units at scale 2 in currency ID 1.",
      "supports": [
        {
          "kind": "finance_review_snapshot",
          "id": "<copy evidencePassage.id>",
          "source_version": "<copy evidencePassage.source_version>",
          "passage_key": "result"
        }
      ]
    }
  ],
  "calculations": []
}
```

For multiple claims, join their exact text in order with spaces. Headings and
caveats must be covered by supported claims too. Do not replace the runtime
FinalDraft schema or add a table outside its claim coverage.
