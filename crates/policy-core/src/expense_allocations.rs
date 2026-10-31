//! One exact byte protocol for API review snapshots and the transactional expense owner.
//! Hashing stays with callers, which already depend on SHA-256.

#[derive(Clone, Copy, Debug)]
pub struct AllocationSnapshotRow<'a> {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub expense_id: u64,
    pub analytic_account_id: Option<u64>,
    pub project_id: Option<u64>,
    pub share_percent: f64,
    pub amount: f64,
    pub billable: bool,
    pub metadata: Option<&'a str>,
}

fn optional_id(bytes: &mut Vec<u8>, value: Option<u64>) {
    bytes.push(u8::from(value.is_some()));
    if let Some(value) = value {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
}

/// Stable across row iteration order, JSON number spelling and optional-value wrappers.
/// Scope and full row identity/content are bound into the review, including empty baselines.
pub fn allocation_snapshot_bytes(
    organization_id: u64,
    company_id: u64,
    expense_id: u64,
    rows: &[AllocationSnapshotRow<'_>],
) -> Result<Vec<u8>, &'static str> {
    if organization_id == 0 || company_id == 0 || expense_id == 0 {
        return Err("expense allocation snapshot requires positive scope");
    }
    let mut sorted: Vec<_> = rows.iter().collect();
    sorted.sort_by_key(|row| row.id);
    let mut bytes = b"lumiere-expense-allocation-review-v1\0".to_vec();
    for value in [organization_id, company_id, expense_id, sorted.len() as u64] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let mut prior = None;
    for row in sorted {
        if row.id == 0
            || prior == Some(row.id)
            || row.organization_id != organization_id
            || row.company_id != company_id
            || row.expense_id != expense_id
            || !row.share_percent.is_finite()
            || !row.amount.is_finite()
        {
            return Err("expense allocation snapshot contains invalid or foreign rows");
        }
        prior = Some(row.id);
        bytes.extend_from_slice(&row.id.to_le_bytes());
        optional_id(&mut bytes, row.analytic_account_id);
        optional_id(&mut bytes, row.project_id);
        bytes.extend_from_slice(&row.share_percent.to_bits().to_le_bytes());
        bytes.extend_from_slice(&row.amount.to_bits().to_le_bytes());
        bytes.push(u8::from(row.billable));
        bytes.push(u8::from(row.metadata.is_some()));
        if let Some(metadata) = row.metadata {
            bytes.extend_from_slice(&(metadata.len() as u64).to_le_bytes());
            bytes.extend_from_slice(metadata.as_bytes());
        }
    }
    Ok(bytes)
}

/// An unreviewed legacy request is safe only for an empty canonical baseline.
pub fn require_reviewed_allocation_snapshot(
    expected: Option<&str>,
    current: &str,
    existing_rows: usize,
) -> Result<(), &'static str> {
    match expected {
        Some(expected) if expected == current => Ok(()),
        None if existing_rows == 0 => Ok(()),
        _ => Err(
            "expense allocations changed or were not reviewed; reload and review the saved rows",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: u64) -> AllocationSnapshotRow<'static> {
        AllocationSnapshotRow {
            id,
            organization_id: 1,
            company_id: 2,
            expense_id: 3,
            analytic_account_id: Some(4),
            project_id: None,
            share_percent: 50.0,
            amount: 123.456789,
            billable: false,
            metadata: Some("évidence"),
        }
    }
    #[test]
    fn stable_order_exact_float_and_scope_are_shared_by_every_caller() {
        let base = allocation_snapshot_bytes(1, 2, 3, &[row(5), row(6)]).unwrap();
        assert_eq!(
            base,
            allocation_snapshot_bytes(1, 2, 3, &[row(6), row(5)]).unwrap()
        );
        let mut changed = row(5);
        changed.amount = f64::from_bits(changed.amount.to_bits() + 1);
        assert_ne!(
            base,
            allocation_snapshot_bytes(1, 2, 3, &[changed, row(6)]).unwrap()
        );
        let mut metadata = row(5);
        metadata.metadata = Some("évidence:");
        assert_ne!(
            base,
            allocation_snapshot_bytes(1, 2, 3, &[metadata, row(6)]).unwrap()
        );
        assert_ne!(
            allocation_snapshot_bytes(1, 2, 3, &[]).unwrap(),
            allocation_snapshot_bytes(1, 2, 4, &[]).unwrap()
        );
    }
    #[test]
    fn malformed_or_cross_scope_rows_cannot_become_snapshots() {
        for bad in [
            AllocationSnapshotRow {
                company_id: 8,
                ..row(5)
            },
            AllocationSnapshotRow {
                amount: f64::NAN,
                ..row(5)
            },
            AllocationSnapshotRow {
                share_percent: f64::INFINITY,
                ..row(5)
            },
        ] {
            assert!(allocation_snapshot_bytes(1, 2, 3, &[bad]).is_err());
        }
        assert!(allocation_snapshot_bytes(1, 2, 3, &[row(5), row(5)]).is_err());
    }
    #[test]
    fn replacement_and_clear_require_the_exact_reviewed_baseline() {
        assert!(require_reviewed_allocation_snapshot(Some("current"), "current", 2).is_ok());
        assert!(require_reviewed_allocation_snapshot(Some("stale"), "current", 2).is_err());
        assert!(require_reviewed_allocation_snapshot(None, "current", 2).is_err());
        assert!(require_reviewed_allocation_snapshot(None, "empty", 0).is_ok());
        assert!(require_reviewed_allocation_snapshot(Some("wrong-scope"), "empty", 0).is_err());
    }
}
