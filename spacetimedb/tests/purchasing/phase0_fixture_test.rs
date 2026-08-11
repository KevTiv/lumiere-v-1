//! Executable persisted-data evidence for the Phase 0 purchasing fixture.

use spacetimedb::ReducerContext;

use crate::test_harness::PurchasingIntegrityFixture;

pub fn test_purchasing_integrity_fixture(ctx: &ReducerContext) -> Result<(), String> {
    let fixture = PurchasingIntegrityFixture::seed(ctx)?;
    fixture.assert_persisted(ctx)
}
