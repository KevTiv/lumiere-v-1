# COV-00C correctness-defect census status

**Status:** ACCEPTANCE CANDIDATE
**Audited base:** `f6071f67a17e9973ff7bbd95cf26510aa5d80d32`
**Machine evidence:** [`../evidence/cov-00c-correctness-defects.json`](../evidence/cov-00c-correctness-defects.json)
**Ratchet:** `python3 scripts/validate-cov00c-correctness-census.py`

## Result

The current correctness classes are owned and launch-gated:

- 11 defect classes have severity, affected surfaces, owners, downstream packages, evidence, and closure gates;
- `COV-D01..D09` and `COV-D11` are resolved and guarded at source level;
- `COV-D10` remains partially resolved and is the only open/partial class;
- all 6 remaining source files using the `AllowEmpty` family are classified as compatibility or fail-closed paths;
- all 9 source/test files rendering `RuntimeFormModal` are classified under the fail-closed runtime-config gate;
- all 50 E2E/helper files using direct reducer/BFF helpers are recorded for COV-00D evidence calibration;
- the 2 remaining named latest/newest functions are production collection semantics, not certification effect selection;
- 864 non-test `stdbBffCommandPost` occurrences remain in query hooks after the
  account-move posting migration. The ratchet ceiling remains 865, and neither
  number is evidence that those actions were applied.

The ratchet fails when a new source file enters an inventoried defect surface without updating ownership, when evidence markers go stale, when required closure metadata disappears, when resolved false-success/convergence guards regress, or when legacy semantic-dispatch debt grows.

## Current downstream blocker

| IDs | Required implementation owner |
| --- | --- |
| `COV-D10` | COH-02/10 + COV-01 and incremental module adoption |

## Limits

This patch closes the source defects and ratchets for COV-D02 through COV-D09. It does not provide live browser/deployment certification, convert direct-BFF browser setup into operator proof, award U4/U5, or close COV-00D. COV-D10 remains a launch blocker for unmigrated consequential actions.
