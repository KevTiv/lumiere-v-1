# Rwanda accounting alpha role matrix

Run these checks with separate identities. Attach a screen recording, trace, or exported audit record for each row and reference its SHA-256 digest in the evidence manifest.

| Capability | Alpha power user | Bookkeeper | Read only |
|---|---:|---:|---:|
| View chart, journals, documents, import history, and reconciliation | Allow | Allow | Allow |
| Create draft invoice and bill | Allow | Allow | Deny |
| Upload and preview migration file | Allow | Allow | Deny |
| Commit opening balances, journals, or outstanding documents | Allow | Allow only when explicitly assigned | Deny |
| Replay original-total historical payments | Allow | Allow only when explicitly assigned | Deny |
| Post invoice, bill, payment, or journal | Allow | Allow only when explicitly assigned | Deny |
| Reconcile bank statement | Allow | Allow only when explicitly assigned | Deny |
| Roll back eligible imports | Allow | Deny unless explicitly assigned | Deny |
| Change company, country pack, tax, fiscal year, or role configuration | Deny unless also tenant admin | Deny | Deny |
| View audit evidence and reports | Allow | Allow | Allow |

The role check passes only when every allowed action succeeds, every denied action fails at the server boundary, and the audit record identifies the acting user. A hidden button alone is not proof of denial.
