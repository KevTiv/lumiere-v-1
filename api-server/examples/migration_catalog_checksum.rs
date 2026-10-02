//! Prints the application PostgreSQL migration catalog checksum that
//! `release-compatibility-manifest.json` records as
//! `durable_postgres.application_catalog_checksum`.
//!
//! Contracts releases can regenerate migration SQL shipped in lumiere-contracts,
//! so `release-contracts.yml` runs this against the new pin and writes the result.
use api_server::cold_tier::migrate::{migration_catalog_checksum, MIGRATIONS};

fn main() {
    println!("{}", migration_catalog_checksum(MIGRATIONS));
}
