//! Deterministic execution of typed workflow condition programs.
//!
//! Evaluation operates only on an immutable, adapter-produced snapshot. It
//! never reads database tables or invokes domain code, so runtime and
//! simulation can share exactly the same semantics.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use sha2::{Digest, Sha256};
use spacetimedb::SpacetimeType;

use crate::workflow::definitions::{
    validate_condition_program, ConditionComparison, ConditionFieldDefinition,
    ConditionInstruction, ConditionProgram, ConditionValue, FixedPointDecimal,
};

/// One allowlisted field captured by a registered subject snapshot adapter.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct ConditionSnapshotField {
    pub field_key: String,
    pub value: ConditionValue,
}

/// Immutable condition input bound to a specific subject revision.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct ConditionSnapshot {
    pub subject_model: String,
    pub subject_id: u64,
    pub subject_revision_hash: String,
    pub fields: Vec<ConditionSnapshotField>,
}

/// Stable machine-readable condition failure categories.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub enum ConditionEvaluationErrorKind {
    InvalidProgram,
    InvalidSnapshotValue,
    DuplicateField,
    UnknownField,
    MissingField,
    NullNotAllowed,
    NullOperand,
    TypeMismatch,
    CurrencyMismatch,
    DecimalOverflow,
}

/// A deterministic condition error suitable for audit and simulation traces.
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct ConditionEvaluationError {
    pub kind: ConditionEvaluationErrorKind,
    pub instruction_index: Option<u32>,
    pub message: String,
}

impl fmt::Display for ConditionEvaluationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

/// Boundary implemented by registered domain adapters in the action/snapshot
/// registry. Keeping this trait database-agnostic prevents condition execution
/// from performing I/O.
pub trait WorkflowSnapshotAdapter<Subject> {
    fn snapshot(&self, subject: &Subject) -> Result<ConditionSnapshot, String>;
}

/// Hash the typed snapshot payload in a field-order-independent canonical form.
///
/// The embedded `subject_revision_hash` is deliberately excluded so callers
/// can compute the hash first and then attach it to the immutable snapshot.
pub fn canonical_condition_snapshot_hash(
    snapshot: &ConditionSnapshot,
) -> Result<String, ConditionEvaluationError> {
    let mut fields: Vec<_> = snapshot.fields.iter().collect();
    fields.sort_by(|left, right| left.field_key.cmp(&right.field_key));

    let mut hasher = Sha256::new();
    hash_string(&mut hasher, &snapshot.subject_model);
    hasher.update(snapshot.subject_id.to_be_bytes());

    let mut previous_key: Option<&str> = None;
    for field in fields {
        if previous_key == Some(field.field_key.as_str()) {
            return Err(error(
                ConditionEvaluationErrorKind::DuplicateField,
                None,
                format!(
                    "snapshot field '{}' appears more than once",
                    field.field_key
                ),
            ));
        }
        previous_key = Some(field.field_key.as_str());
        validate_snapshot_value(&field.field_key, &field.value)?;
        hash_string(&mut hasher, &field.field_key);
        hash_condition_value(&mut hasher, &field.value);
    }

    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn hash_string(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}

fn hash_condition_value(hasher: &mut Sha256, value: &ConditionValue) {
    match value {
        ConditionValue::Null => hasher.update([0]),
        ConditionValue::Boolean(value) => hasher.update([1, u8::from(*value)]),
        ConditionValue::Integer(value) => {
            hasher.update([2]);
            hasher.update(value.to_be_bytes());
        }
        ConditionValue::Decimal(value) => {
            hasher.update([3]);
            hasher.update(value.coefficient.to_be_bytes());
            hasher.update(value.scale.to_be_bytes());
        }
        ConditionValue::Money(value) => {
            hasher.update([4]);
            hasher.update(value.minor_units.to_be_bytes());
            hash_string(hasher, &value.currency);
        }
        ConditionValue::Text(value) => {
            hasher.update([5]);
            hash_string(hasher, value);
        }
        ConditionValue::Date(value) => {
            hasher.update([6]);
            hasher.update(value.to_be_bytes());
        }
        ConditionValue::Timestamp(value) => {
            hasher.update([7]);
            hasher.update(value.to_be_bytes());
        }
        ConditionValue::Code(value) => {
            hasher.update([8]);
            hash_string(hasher, value);
        }
    }
}

/// Validate a snapshot against its version-pinned allowlist.
///
/// Missing fields are intentionally accepted here and fail only if a program
/// loads them. This makes sparse snapshots safe while preserving an explicit
/// [`ConditionEvaluationErrorKind::MissingField`] outcome.
pub fn validate_condition_snapshot(
    snapshot_fields: &[ConditionFieldDefinition],
    snapshot: &ConditionSnapshot,
) -> Result<(), ConditionEvaluationError> {
    let schema: BTreeMap<_, _> = snapshot_fields
        .iter()
        .map(|field| (field.field_key.as_str(), field))
        .collect();
    let mut seen = BTreeSet::new();

    for field in &snapshot.fields {
        if !seen.insert(field.field_key.as_str()) {
            return Err(error(
                ConditionEvaluationErrorKind::DuplicateField,
                None,
                format!(
                    "snapshot field '{}' appears more than once",
                    field.field_key
                ),
            ));
        }
        let Some(definition) = schema.get(field.field_key.as_str()) else {
            return Err(error(
                ConditionEvaluationErrorKind::UnknownField,
                None,
                format!("snapshot field '{}' is not allowlisted", field.field_key),
            ));
        };
        match &field.value {
            ConditionValue::Null if !definition.nullable => {
                return Err(error(
                    ConditionEvaluationErrorKind::NullNotAllowed,
                    None,
                    format!("snapshot field '{}' cannot be null", field.field_key),
                ));
            }
            ConditionValue::Null => {}
            value if value.value_type() != definition.value_type => {
                return Err(error(
                    ConditionEvaluationErrorKind::TypeMismatch,
                    None,
                    format!(
                        "snapshot field '{}' has type {:?}, expected {:?}",
                        field.field_key,
                        value.value_type(),
                        definition.value_type
                    ),
                ));
            }
            value => validate_snapshot_value(&field.field_key, value)?,
        }
    }
    Ok(())
}

fn validate_snapshot_value(
    field_key: &str,
    value: &ConditionValue,
) -> Result<(), ConditionEvaluationError> {
    match value {
        ConditionValue::Decimal(decimal) if decimal.scale > 18 => Err(error(
            ConditionEvaluationErrorKind::InvalidSnapshotValue,
            None,
            format!("snapshot field '{field_key}' decimal scale cannot exceed 18"),
        )),
        ConditionValue::Money(money)
            if money.currency.len() != 3
                || !money.currency.bytes().all(|byte| byte.is_ascii_uppercase()) =>
        {
            Err(error(
                ConditionEvaluationErrorKind::InvalidSnapshotValue,
                None,
                format!(
                    "snapshot field '{field_key}' currency must be a three-letter uppercase code"
                ),
            ))
        }
        _ => Ok(()),
    }
}

/// Execute a validated postfix condition program over an immutable snapshot.
pub fn evaluate_condition_program(
    program: &ConditionProgram,
    snapshot_fields: &[ConditionFieldDefinition],
    snapshot: &ConditionSnapshot,
) -> Result<bool, ConditionEvaluationError> {
    validate_condition_program(program, snapshot_fields)
        .map_err(|message| error(ConditionEvaluationErrorKind::InvalidProgram, None, message))?;
    validate_condition_snapshot(snapshot_fields, snapshot)?;

    let values: BTreeMap<_, _> = snapshot
        .fields
        .iter()
        .map(|field| (field.field_key.as_str(), &field.value))
        .collect();
    let mut stack = Vec::with_capacity(program.instructions.len().min(32));

    for (index, instruction) in program.instructions.iter().enumerate() {
        let instruction_index = u32::try_from(index).unwrap_or(u32::MAX);
        match instruction {
            ConditionInstruction::PushValue(value) => stack.push(value.clone()),
            ConditionInstruction::LoadField(field_key) => {
                let value = values.get(field_key.as_str()).ok_or_else(|| {
                    error(
                        ConditionEvaluationErrorKind::MissingField,
                        Some(instruction_index),
                        format!("snapshot field '{field_key}' is missing"),
                    )
                })?;
                stack.push((*value).clone());
            }
            ConditionInstruction::Compare(operator) => {
                let right = pop_value(&mut stack, instruction_index)?;
                let left = pop_value(&mut stack, instruction_index)?;
                stack.push(ConditionValue::Boolean(compare_values(
                    &left,
                    &right,
                    operator,
                    instruction_index,
                )?));
            }
            ConditionInstruction::And | ConditionInstruction::Or => {
                let right = pop_boolean(&mut stack, instruction_index)?;
                let left = pop_boolean(&mut stack, instruction_index)?;
                let value = matches!(instruction, ConditionInstruction::And) && left && right
                    || matches!(instruction, ConditionInstruction::Or) && (left || right);
                stack.push(ConditionValue::Boolean(value));
            }
            ConditionInstruction::Not => {
                let value = pop_boolean(&mut stack, instruction_index)?;
                stack.push(ConditionValue::Boolean(!value));
            }
        }
    }

    match stack.pop() {
        Some(ConditionValue::Boolean(value)) if stack.is_empty() => Ok(value),
        _ => Err(error(
            ConditionEvaluationErrorKind::InvalidProgram,
            None,
            "condition program did not produce one Boolean result".to_string(),
        )),
    }
}

fn compare_values(
    left: &ConditionValue,
    right: &ConditionValue,
    operator: &ConditionComparison,
    instruction_index: u32,
) -> Result<bool, ConditionEvaluationError> {
    if matches!(left, ConditionValue::Null) || matches!(right, ConditionValue::Null) {
        return match operator {
            ConditionComparison::Equal => {
                Ok(matches!(left, ConditionValue::Null) && matches!(right, ConditionValue::Null))
            }
            ConditionComparison::NotEqual => Ok(
                !(matches!(left, ConditionValue::Null) && matches!(right, ConditionValue::Null))
            ),
            _ => Err(error(
                ConditionEvaluationErrorKind::NullOperand,
                Some(instruction_index),
                "null values do not support ordered comparison".to_string(),
            )),
        };
    }

    let ordering = match (left, right) {
        (ConditionValue::Boolean(left), ConditionValue::Boolean(right)) => left.cmp(right),
        (ConditionValue::Integer(left), ConditionValue::Integer(right)) => left.cmp(right),
        (ConditionValue::Decimal(left), ConditionValue::Decimal(right)) => {
            compare_decimals(left, right, instruction_index)?
        }
        (ConditionValue::Money(left), ConditionValue::Money(right)) => {
            if left.currency != right.currency {
                return Err(error(
                    ConditionEvaluationErrorKind::CurrencyMismatch,
                    Some(instruction_index),
                    format!(
                        "money currencies differ: {} and {}",
                        left.currency, right.currency
                    ),
                ));
            }
            left.minor_units.cmp(&right.minor_units)
        }
        (ConditionValue::Text(left), ConditionValue::Text(right)) => left.cmp(right),
        (ConditionValue::Date(left), ConditionValue::Date(right)) => left.cmp(right),
        (ConditionValue::Timestamp(left), ConditionValue::Timestamp(right)) => left.cmp(right),
        (ConditionValue::Code(left), ConditionValue::Code(right)) => left.cmp(right),
        _ => {
            return Err(error(
                ConditionEvaluationErrorKind::TypeMismatch,
                Some(instruction_index),
                format!(
                    "comparison operand types differ: {:?} and {:?}",
                    left.value_type(),
                    right.value_type()
                ),
            ));
        }
    };

    Ok(match operator {
        ConditionComparison::Equal => ordering == Ordering::Equal,
        ConditionComparison::NotEqual => ordering != Ordering::Equal,
        ConditionComparison::LessThan => ordering == Ordering::Less,
        ConditionComparison::LessThanOrEqual => ordering != Ordering::Greater,
        ConditionComparison::GreaterThan => ordering == Ordering::Greater,
        ConditionComparison::GreaterThanOrEqual => ordering != Ordering::Less,
    })
}

fn compare_decimals(
    left: &FixedPointDecimal,
    right: &FixedPointDecimal,
    instruction_index: u32,
) -> Result<Ordering, ConditionEvaluationError> {
    let scale = left.scale.max(right.scale);
    let left_multiplier = checked_power_of_ten(scale - left.scale, instruction_index)?;
    let right_multiplier = checked_power_of_ten(scale - right.scale, instruction_index)?;
    let left = i128::from(left.coefficient)
        .checked_mul(left_multiplier)
        .ok_or_else(|| decimal_overflow(instruction_index))?;
    let right = i128::from(right.coefficient)
        .checked_mul(right_multiplier)
        .ok_or_else(|| decimal_overflow(instruction_index))?;
    Ok(left.cmp(&right))
}

fn checked_power_of_ten(
    exponent: u32,
    instruction_index: u32,
) -> Result<i128, ConditionEvaluationError> {
    10_i128
        .checked_pow(exponent)
        .ok_or_else(|| decimal_overflow(instruction_index))
}

fn pop_value(
    stack: &mut Vec<ConditionValue>,
    instruction_index: u32,
) -> Result<ConditionValue, ConditionEvaluationError> {
    stack.pop().ok_or_else(|| {
        error(
            ConditionEvaluationErrorKind::InvalidProgram,
            Some(instruction_index),
            "condition instruction is missing an operand".to_string(),
        )
    })
}

fn pop_boolean(
    stack: &mut Vec<ConditionValue>,
    instruction_index: u32,
) -> Result<bool, ConditionEvaluationError> {
    match pop_value(stack, instruction_index)? {
        ConditionValue::Boolean(value) => Ok(value),
        value => Err(error(
            ConditionEvaluationErrorKind::TypeMismatch,
            Some(instruction_index),
            format!("boolean operator received {:?} operand", value.value_type()),
        )),
    }
}

fn decimal_overflow(instruction_index: u32) -> ConditionEvaluationError {
    error(
        ConditionEvaluationErrorKind::DecimalOverflow,
        Some(instruction_index),
        "fixed-point decimal comparison overflowed".to_string(),
    )
}

fn error(
    kind: ConditionEvaluationErrorKind,
    instruction_index: Option<u32>,
    message: String,
) -> ConditionEvaluationError {
    ConditionEvaluationError {
        kind,
        instruction_index,
        message,
    }
}
