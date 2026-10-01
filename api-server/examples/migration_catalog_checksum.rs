//! Prints the runtime migration catalog checksum for the contracts release pin.
use api_server::cold_tier::migrate::{migration_catalog_checksum, MIGRATIONS};

fn main() {
    println!("{}", migration_catalog_checksum(MIGRATIONS));
}
