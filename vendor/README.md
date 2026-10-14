# Vendored release artifacts

`lumiere-contracts-rust-0.3.106.tar.gz` contains the Rust crate and manifests
from `KevTiv/lumiere-contracts` commit
`4b90e7c2cdc5bd549b2e261a24d13f7a47dc0099` (release `0.3.106`). The Rust
Railway image verifies the adjacent SHA-256 file before extracting it. This
keeps source builds deterministic without granting a hosted builder SSH access
to the private contracts repository.

The archive contains only these release paths:

- `lumiere-contracts/crates/lumiere-contracts/`
- `lumiere-contracts/manifests/`

To reproduce it from a checkout at the pinned commit:

```sh
staging="$(mktemp -d)"
mkdir -p "$staging/lumiere-contracts/crates"
cp -a crates/lumiere-contracts "$staging/lumiere-contracts/crates/"
cp -a manifests "$staging/lumiere-contracts/"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -C "$staging" -czf lumiere-contracts-rust-0.3.106.tar.gz lumiere-contracts
sha256sum lumiere-contracts-rust-0.3.106.tar.gz
```
