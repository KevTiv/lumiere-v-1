# COV-00C correctness-defect census status

**Status:** ACCEPTANCE CANDIDATE
**Audited base:** `77f94ef5ea0bd912863acb0a7d12884ad3ad8ecb`
**Machine evidence:** [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json)
**Ratchet:** `python3 scripts/validate-cov00c-correctness-census.py`

## Result

The current correctness classes are owned and launch-gated without treating the census as authority to repair every runtime path:

- 11 defect classes have severity, affected surfaces, owners, downstream packages, evidence, and closure gates;
- `COV-D01` false success and `COV-D11` convergence vocabulary are resolved and guarded;
- 7 classes remain open and 2 remain partially resolved;
- all 31 source files using the `AllowEmpty` family are classified;
- all 8 files rendering `RuntimeFormModal` are classified under the degraded-config gate;
- all 37 E2E/helper files using direct reducer/BFF helpers are recorded for COV-00D evidence calibration;
- all 9 named latest/newest helpers in the governed query-hook and E2E scopes are classified;
- the 866 non-test `stdbBffCommandPost` occurrences in query hooks are a non-growth semantic-outcome debt baseline, not evidence that those actions are applied.

The ratchet fails when a new source file enters an inventoried defect surface without updating ownership, when evidence markers go stale, when required closure metadata disappears, when resolved false-success/convergence guards regress, or when legacy semantic-dispatch debt grows.

## Current downstream blockers

| IDs | Required implementation owner |
| --- | --- |
| `COV-D02` | GOV/CAP + COH exact-effect identity for AI action drafts |
| `COV-D03` | UX shared resource states + COV-23/COV-26 |
| `COV-D04` | UX-07 + COV-22 fail-closed runtime forms |
| `COV-D05..07` | UX-08 + COV-20/COV-26 truthful dashboard definitions, completeness, and source state |
| `COV-D08` | COV-00D calibration, then owning COV-03..24 operator paths and COV-27 |
| `COV-D09` | COV-01 and module test owners; CRM is repaired, other latest/highest helpers remain |
| `COV-D10` | COH-02/10 + COV-01 and incremental module adoption |

## Limits

This candidate closes COV-00C classification mechanics only. It does not certify the affected runtime surfaces, convert direct-BFF browser setup into operator proof, award U4/U5, or close COV-00D. Open and partially resolved rows remain launch blockers for their named downstream gates.
