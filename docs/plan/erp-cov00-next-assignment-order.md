# COV-00 next assignment order

After review of the census, use this dependency order rather than starting broad module rewrites:

```text
COV-00A operation census ─┐
                          ├─> COV-00 acceptance
COV-00B exposure manifest ┘

COH-02 typed outcomes ─────> COV-01 shared workflow boundary
COV-00 acceptance ─────────> COV-02 first-org seed/personas

then parallel module lanes:
A CRM → Sales
B Purchasing → Inventory → Manufacturing
C Accounting → Expenses / Subscriptions / POS
D HR / Projects / Helpdesk / Fleet / IoT
E Documents / Calendar / Messages / Reports / Approvals / Imports / Settings
```

Prioritize closing U4/U5 gaps on CRM/Sales/Purchasing/Accounting before adding new backend breadth. Inventory/Manufacturing and the people/service lane need stronger operator-reachable lifecycle proof. Fleet needs its canonical `/map` versus dedicated-route decision before UI expansion.
