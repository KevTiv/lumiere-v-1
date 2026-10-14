# Vendored release artifacts

`lumiere-contracts-rust-0.3.106.tar.gz` contains the released Rust crate,
manifests, generated TypeScript contracts, contract IR, and generator
from `KevTiv/lumiere-contracts` commit
`4b90e7c2cdc5bd549b2e261a24d13f7a47dc0099` (release `0.3.106`). The Rust
Railway image verifies the adjacent SHA-256 file before extracting it. This
keeps source builds deterministic without granting a hosted builder SSH access
to the private contracts repository.

The archive contains these release paths:

- `lumiere-contracts/CONTRACT_VERSION`
- `lumiere-contracts/VENDORED_SOURCE.json`
- `lumiere-contracts/crates/lumiere-contracts/`
- `lumiere-contracts/manifests/`
- `lumiere-contracts/packages/contracts/src/`
- `lumiere-contracts/ir/`
- `lumiere-contracts/scripts/generate-from-ir.py`

To reproduce it from a checkout at the pinned commit:

```sh
bash scripts/package-contracts-rust.sh \
  /path/to/lumiere-contracts 0.3.106 vendor
```

The packager records the source repository, exact Git revision, and version in
`VENDORED_SOURCE.json`; preparation checks those values against the release
compatibility manifest before exposing the package to Cargo.
