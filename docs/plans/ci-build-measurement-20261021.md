# CI compilation baseline, 21 October 2026

Measured the latest 100 workflow runs at approximately 12:20 UTC, selecting 62
CI, E2E, image, and successful contract-release runs: 256 jobs (235 completed,
18 running, 3 queued). Job metadata contains the latest attempt of each run.
The sample is bounded and selected; it is not a repository-wide historical
benchmark. Eleven contract-module jobs, ten successful E2E artifact jobs, and
eight successful Rust image jobs supplied 29 completed-job logs.

Only successful completed steps contribute to timings. Completed steps in
running workflows count, while running steps are incomplete observations.
Queue time measures job creation to runner start for jobs with successful setup;
dependency waits before job creation are additional. Medians below are separate
distributions and must not be added as though they describe one critical path.

| Successful work | Samples | Median minutes | P90 minutes | Range minutes |
|---|---:|---:|---:|---:|
| Rust image build step | 8 | 37.6 | 41.7 | 30.1–41.7 |
| E2E artifact job, total | 10 | 19.2 | 21.3 | 15.1–21.7 |
| E2E module compilation | 10 | 10.4 | 11.2 | 8.1–12.0 |
| E2E API compilation/validation | 10 | 4.8 | 5.3 | 3.7–5.5 |
| Contracts module compilation | 11 | 5.0 | 5.6 | 3.8–5.7 |
| Frontend typecheck | 8 | 5.0 | 6.0 | 3.8–6.0 |

E2E runner queue: median 15.5 minutes, P90 38.2, maximum 50.9 (78 jobs).
CI runner queue: median 17.1 minutes, P90 46.0, maximum 59.3 (82 jobs).
Compilation and runner saturation both contribute materially to elapsed time.
Several running E2E jobs had already reached browser execution; their remaining
time cannot be attributed to compilation.

## Cache evidence

All ten sampled E2E artifact builds missed their exact-commit archive, compiled
WASM, compiled API, and Next.js compiler caches. All eleven sampled contract
module builds missed their compiled-module cache. A restore step's successful
status only means the action ran: the logs explicitly said the entries were
not found, followed by compilation and a successful save.

Five separate PR jobs compiled exactly this E2E WASM key for a combined 51.6
runner-minutes:

`e2e-wasm-v1-Linux-X64-750cc29e1a4a3655769d08fb119898b9e08deb2e89902b32535ce0b10f66546b`

- [#240, 12.0 minutes](https://github.com/KevTiv/lumiere-v-1/actions/runs/39586458553/job/119181760995)
- [#216, 8.5 minutes](https://github.com/KevTiv/lumiere-v-1/actions/runs/39586417012/job/119186807111)
- [#224, 10.4 minutes](https://github.com/KevTiv/lumiere-v-1/actions/runs/39585929130/job/119181856471)
- [#231, 10.6 minutes](https://github.com/KevTiv/lumiere-v-1/actions/runs/39585882664/job/119174733567)
- [#233, 10.1 minutes](https://github.com/KevTiv/lumiere-v-1/actions/runs/39585881621/job/119181577543)

The [main E2E job](https://github.com/KevTiv/lumiere-v-1/actions/runs/39565815340/job/119107785995)
saved that same key at 08:10:02 UTC, before the five PR lookups. Main also saved
the API key requested by both #240 and #233 at 08:15:14 UTC, and the contracts
module key requested by four sampled jobs at 08:07:55 UTC. Those PR lookups
still missed. PR caches cannot generally serve unrelated PRs, but main's caches
should be eligible. This is evidence to inspect retention/visibility, not proof
that cache keys need broadening.

The connector rejected the read-only cache inventory endpoint as unsupported.
Current cache usage, cache limits, manual deletion, and eviction are therefore
**unconfirmed**. The manual collector added with this report requests inventory
using the workflow's read-only Actions token and records access failures without
losing timing data. No caches were deleted during measurement.

## Rust image evidence

All eight sampled successful Rust image builds logged 476 crate compilations,
even though BuildKit imported its GHA cache manifest. Cache preparation/export
took roughly 2.5–4 minutes in these logs. For example,
[run 39592450998](https://github.com/KevTiv/lumiere-v-1/actions/runs/39592450998/job/119197115784)
spent 31m29s building the API binaries, another 4m28s building the gateway, and
223s exporting cache.

`Dockerfile.rust-runtime` copies the Rust source trees before a single build
layer. Any changed copied source invalidates that layer; the Dockerfile has no
separate dependency compilation layer. A layer-cache hit on setup does not
provide Cargo dependency reuse when the final compilation layer misses.
Production release uses optimized code and LTO; E2E uses different profiles.
Their binaries cannot be interchanged merely because they share source files.

## Improvements to validate, in priority order

1. **Measure cache storage and retention.** Rank entries by size/ref/access time,
   identify obsolete PR/exact-commit duplicates, and retain useful default-branch
   content-keyed artifacts. The existing E2E module/API fingerprints already
   identify identical inputs. Confirm a later PR restores a main-produced key.
   Cleanup must target identified obsolete entries; deleting all compiled caches
   would make builds slower. This report does not perform cleanup or alter limits.
2. **Separate Rust dependency compilation from application source compilation.**
   Prepare a dependency recipe/layer before copying application sources, keeping
   contracts, build scripts, native inputs, compiler, features and release profile
   in the cache identity. Validate clean-build parity and incremental rebuild
   behavior using two consecutive source revisions. Do not assume BuildKit cache
   mounts survive hosted runners without an explicit persistence mechanism.
3. **Reduce redundant work while keeping checks.** Existing E2E builds already
   compile once and fan out verified artifacts; superseded PR runs already cancel.
   Prioritize reuse and runner capacity before adding shards/jobs or duplicating
   existing caches. Test compiler caching only after identifying which remaining
   crates/build scripts/link steps actually benefit. Keep full release browser,
   contract drift and database regression coverage.

The five identical WASM PR compiles represent 51.6 observed runner-minutes;
this is not a promised reduction. Other PR branches changed contracts or native
inputs, and their distinct keys must continue to invalidate caches correctly.
An optimization is accepted only after a cold build, a matching-input warm build,
and a source/contract/toolchain change demonstrate correct reuse/invalidation,
with fresh complete CI results and measured queue/build time reported separately.

## Repeat the measurement

Run **Measure CI builds** manually from Actions once available on main. It has
only `contents: read` and `actions: read` permissions, reads up to 100 recent
runs, keeps up to 30 selected completed-job log observations, and uploads a
14-day report artifact. It creates no scheduled work, reruns, deployments, or
cache mutations. Raw job logs and environment dumps are not retained.

CLI with an authenticated `gh`:

```sh
python3 scripts/measure-ci-builds.py --output /tmp/ci-measurement
```

Offline analysis of a saved snapshot:

```sh
python3 scripts/measure-ci-builds.py \
  --snapshot /tmp/ci-measurement/snapshot.json \
  --cache-observations /tmp/ci-measurement/cache-observations.json \
  --cache-inventory /tmp/ci-measurement/cache-inventory.json \
  --output /tmp/ci-reanalysis
```

The initial raw snapshot and filtered observations are retained in the task
workspace at `/workspace/ci-build-measurement-20261021/`; generated JSON is kept
out of the source repository. Six focused tests cover incomplete/cancelled jobs,
duplicate jobs, successful-step timing, cache log filtering, and pagination.
