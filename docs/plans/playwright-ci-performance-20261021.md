# Playwright CI duration and setup improvements

The successful financial alpha run
[39624487039](https://github.com/KevTiv/lumiere-v-1/actions/runs/39624487039)
used one worker per shard. Browser execution ranged from 5.8 to 30.9 minutes;
runner/browser/artifact preparation was about 1.5–2 minutes. Equal test counts
did not give equal workloads. `Makefile` sets `E2E_WORKERS=1`, overriding the
four-worker fallback in the Playwright configuration.

## Changes

- Assign complete test files to the existing six full or three P0 shards by
  descending estimated cost. Preserve suite filters, projects, serial groups,
  retries, native checks, fresh databases and one worker per shard. Targeted and
  pretenant lanes retain their selection rules.
- Discover the current inventory on every plan, including new test files with
  a default scheduling weight. Reject incomplete or duplicate assignments.
  Verify the resulting plan against actual Playwright discovery in CI.
- Seed scheduling weights from single-worker test-start intervals in the
  successful run above. These are estimates including intervening fixture work,
  not precise per-test benchmarks. They predict approximately 15 minutes per
  full shard; hosted execution must establish the actual result.
- Emit inert per-test timing reports on every completed browser run, including
  retry cost. Do not include stdout, errors, attachments, cookies or auth state.
- Key Chromium by installed Playwright/core versions, browser revisions, OS and
  architecture. Changes to unrelated dependencies or contracts retain this key.
  Continue installing system dependencies on each fresh runner.
- Let the workflow install Chromium once. Local Make invocations still install
  it unless the caller explicitly reports successful preparation.

## Updating scheduling weights

Download all `playwright-timings-full-*` artifacts from one successful full
workflow run into a local directory. Review and update the checked-in baseline:

```sh
python3 scripts/update-playwright-durations.py /tmp/timings/*.json \
  --output scripts/playwright-test-durations.json
```

The importer rejects failed runs, mixed source commits, incomplete partition
sets and duplicate test identities. New or unknown files remain included even
without measured weights. Durations influence assignment only, never selection.

## Validation and remaining measurements

Local Playwright discovery compared the original suite with every new shard:
all 397 full and 186 P0 non-setup test instances were assigned exactly once.
Setup projects continue to run as dependencies within isolated shard runtimes.
Scheduling, browser-key invalidation, timing redaction/retry accounting and
single-install behavior have focused regression checks.

Keep the native reducer certification in each runtime for this change: those
checks can affect fixture state, so moving them requires a separate fixture
parity proof. Increasing workers also requires fixture isolation verification.
Compare hosted browser durations, setup and queue time separately; no measured
speedup is claimed before the new full run completes.
