# Farm fix merge candidate

This branch combines original PR heads with merge commits, preserving ancestry:
#340 ec3dad26545c8d27765f9456ba62c0c100362438;
#341 7c4a7aaecddd0f239d72ec9e087654180701609a;
#343 187fd48ee74d665e725ec2742a7ac9704c570c89;
#344 fe77fd049c35e6ba24a6387b1f5ac78d23c16a55, then6c40d224a415708afb8506bf5365f5a440f02a1e.
Main already includes #342 at4b6f045a565eb9e4e0fe6496e600db409379292a.

Shared source changes merge both intents. The unit-test script retains each
branch's tests. English locale and ingestion changes merged without source
conflicts. Proposed Finance source hashes were regenerated after the final
source merge, without registration or activation.

The three branch contract pins conflict. A coherent0.3.162 pin is retained as
the generation baseline; inactive0.3.160/0.3.161 archives introduced by the merge
are removed. The combined query registry needs a fresh immutable contract and
consumer pin before merge. The standard release workflow performs that step.
No released migration or application catalog entry was changed.

Native module sources and codegen Rust sources match #344. Local SDK generation
used its verified CI module artifact13054501160 (ZIP SHA256
ccb79e95d6212fff1545944f7518360767b65c31fde5e71a61f5b02a72e364c2).
Generation succeeds with1,496operations,373resources and524tables. Its combined
schema hash is sha256:e51dd0be452eb5de1f803086543678210bf67015729e2fed275e150ea175ed77.

Validation before publication:

- 44focused TypeScript tests passed on the final combined source.
- 141codegen tests passed; one ignored.
- 92authorization tests passed from this combined checkout.
- Contract IR, operation history, Finance inventory and proposed manifest checks passed.
- The dialog follow-up reproduces the old double-dialog failure and passes34mounted tests on its source branch. A second mounted run from this combined checkout did not execute because borrowed dependencies resolve an older shared package; no combined mounted pass is claimed.
- Current-head hosted CI, contract drift and lead-to-cash E2E remain mandatory before main merge.

The dialog fix gives a configured record sheet precedence over the legacy
record opener. It leaves fallback dialogs on tabs without sheets and keeps the
exact E2E link/record assertions unchanged.

The primary working checkout and its local edits are unchanged. No farm record,
posting, stock, AI budget, certification or service grant was changed by merge
preparation. This evidence describes source validation, not live farm acceptance.
The repository's green-main workflow releases to Railway after the final merge;
served-revision and original-file acceptance remain separate readback steps.
