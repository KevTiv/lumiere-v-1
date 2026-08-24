use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Exposure {
    Denied,
    Session,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScalarKind {
    Bool,
    Float,
    SignedInteger,
    UnsignedInteger,
    OptionalBool,
    OptionalFloat,
    OptionalSignedInteger,
    OptionalUnsignedInteger,
    OptionalString,
    String,
    Composite,
}

#[derive(Clone, Copy, Debug)]
pub struct ReducerParam {
    pub name: &'static str,
    pub kind: ScalarKind,
    pub ref_target: Option<&'static str>,
}

#[derive(Clone, Copy, Debug)]
pub struct CompanyScopePath {
    /// Position of the root reducer parameter in the positional STDB call.
    pub parameter_position: usize,
    /// Canonical snake_case path within that parameter; empty for a direct
    /// `company_id` parameter.
    pub path: &'static [&'static str],
    pub required: bool,
    pub nullable: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct ReducerContract {
    pub name: &'static str,
    pub params: &'static [ReducerParam],
    pub lifecycle: &'static str,
    pub exposure: Exposure,
    pub organization_position: Option<usize>,
    pub company_position: Option<usize>,
    pub unscoped_reason: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReducerName(&'static str);

impl ReducerName {
    pub const fn new(name: &'static str) -> Self {
        Self(name)
    }

    pub const fn as_str(self) -> &'static str {
        self.0
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ReducerContractError {
    #[error("unknown reducer: {0}")]
    UnknownReducer(String),
    #[error("reducer {reducer} arguments must be a JSON array")]
    ArgumentsNotArray { reducer: &'static str },
    #[error("reducer {reducer} expects {expected} arguments, got {actual}")]
    WrongArity {
        reducer: &'static str,
        expected: usize,
        actual: usize,
    },
    #[error("reducer {reducer} argument {position} ({parameter}) must be {expected}")]
    WrongScalarKind {
        reducer: &'static str,
        position: usize,
        parameter: &'static str,
        expected: &'static str,
    },
}

#[derive(Debug)]
pub struct ReducerCall {
    contract: &'static ReducerContract,
    args: Vec<Value>,
}

pub trait IntoReducerCall {
    fn into_reducer_call(self) -> Result<ReducerCall, ReducerContractError>;
}

impl IntoReducerCall for ReducerCall {
    fn into_reducer_call(self) -> Result<ReducerCall, ReducerContractError> {
        Ok(self)
    }
}

impl IntoReducerCall for Result<ReducerCall, ReducerContractError> {
    fn into_reducer_call(self) -> Result<ReducerCall, ReducerContractError> {
        self
    }
}

impl ReducerCall {
    pub fn new(name: ReducerName, args: Value) -> Result<Self, ReducerContractError> {
        Self::from_name(name.as_str(), args)
    }

    pub fn from_name(name: &str, args: Value) -> Result<Self, ReducerContractError> {
        let contract = reducer_contract(name)
            .ok_or_else(|| ReducerContractError::UnknownReducer(name.to_owned()))?;
        let mut args = args
            .as_array()
            .cloned()
            .ok_or(ReducerContractError::ArgumentsNotArray {
                reducer: contract.name,
            })?;
        if args.len() != contract.params.len() {
            return Err(ReducerContractError::WrongArity {
                reducer: contract.name,
                expected: contract.params.len(),
                actual: args.len(),
            });
        }
        for (position, (value, param)) in args.iter_mut().zip(contract.params).enumerate() {
            let Some(normalized) = param.kind.normalize_input(value) else {
                return Err(ReducerContractError::WrongScalarKind {
                    reducer: contract.name,
                    position,
                    parameter: param.name,
                    expected: param.kind.description(),
                });
            };
            *value = normalized;
        }
        Ok(Self { contract, args })
    }

    pub fn contract(&self) -> &'static ReducerContract {
        self.contract
    }

    pub fn args(&self) -> &[Value] {
        &self.args
    }

    pub(crate) fn into_parts(self) -> (&'static ReducerContract, Vec<Value>) {
        (self.contract, self.args)
    }
}

impl ScalarKind {
    fn normalize_input(self, value: &Value) -> Option<Value> {
        if self.is_optional() {
            if let Some(object) = value.as_object() {
                if object.len() == 1 && object.contains_key("none") {
                    return Some(Value::Null);
                }
                if object.len() == 1 {
                    if let Some(inner) = object.get("some") {
                        return self.normalize_untagged_input(inner);
                    }
                }
            }
        }
        self.normalize_untagged_input(value)
    }

    fn normalize_untagged_input(self, value: &Value) -> Option<Value> {
        match self {
            Self::OptionalSignedInteger if value.is_null() => Some(Value::Null),
            Self::OptionalUnsignedInteger if value.is_null() => Some(Value::Null),
            Self::SignedInteger | Self::OptionalSignedInteger => value
                .as_i64()
                .or_else(|| value.as_str()?.parse::<i64>().ok())
                .map(Value::from),
            Self::UnsignedInteger | Self::OptionalUnsignedInteger => value
                .as_u64()
                .or_else(|| value.as_str()?.parse::<u64>().ok())
                .map(Value::from),
            _ => self.accepts(value).then(|| value.clone()),
        }
    }

    fn is_optional(self) -> bool {
        matches!(
            self,
            Self::OptionalBool
                | Self::OptionalFloat
                | Self::OptionalSignedInteger
                | Self::OptionalUnsignedInteger
                | Self::OptionalString
        )
    }

    fn accepts(self, value: &Value) -> bool {
        match self {
            Self::Bool => value.is_boolean(),
            Self::Float => value.is_number(),
            Self::SignedInteger => value.as_i64().is_some(),
            Self::UnsignedInteger => value.as_u64().is_some(),
            Self::String => value.is_string(),
            Self::OptionalBool => value.is_null() || value.is_boolean(),
            Self::OptionalFloat => value.is_null() || value.is_number(),
            Self::OptionalSignedInteger => value.is_null() || value.as_i64().is_some(),
            Self::OptionalUnsignedInteger => value.is_null() || value.as_u64().is_some(),
            Self::OptionalString => value.is_null() || value.is_string(),
            Self::Composite => true,
        }
    }

    const fn description(self) -> &'static str {
        match self {
            Self::Bool => "a boolean",
            Self::Float => "a number",
            Self::SignedInteger => "an integer",
            Self::UnsignedInteger => "an unsigned integer",
            Self::String => "a string",
            Self::OptionalBool => "a boolean or null",
            Self::OptionalFloat => "a number or null",
            Self::OptionalSignedInteger => "an integer or null",
            Self::OptionalUnsignedInteger => "an unsigned integer or null",
            Self::OptionalString => "a string or null",
            Self::Composite => "a composite value",
        }
    }
}

include!("generated_reducer_contract.rs");

pub fn reducer_contract(name: &str) -> Option<&'static ReducerContract> {
    REDUCER_CONTRACTS
        .binary_search_by_key(&name, |contract| contract.name)
        .ok()
        .map(|index| &REDUCER_CONTRACTS[index])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_identity_first_reducer_by_manifest_arity_and_scalar_types() {
        let contract = reducer_contract("assign_role").expect("assign_role contract");
        assert_eq!(contract.organization_position, Some(2));
        assert!(
            ReducerCall::from_name("assign_role", json!([{"__identity__": "00"}, 4, 7, {}]))
                .is_ok()
        );
        assert!(matches!(
            ReducerCall::from_name("assign_role", json!([{}, 4, "seven", {}])),
            Err(ReducerContractError::WrongScalarKind { position: 2, .. })
        ));
    }

    #[test]
    fn rejects_unknown_reducer_and_wrong_arity() {
        assert!(matches!(
            ReducerCall::from_name("not_a_reducer", json!([])),
            Err(ReducerContractError::UnknownReducer(_))
        ));
        assert!(matches!(
            ReducerCall::from_name("create_lead", json!([1])),
            Err(ReducerContractError::WrongArity { .. })
        ));
    }

    #[test]
    fn normalizes_tagged_top_level_options_before_validation() {
        let some = ReducerCall::from_name(
            "create_workflow",
            json!([7, { "some": 42 }, { "metadata": { "none": [] } }]),
        )
        .expect("tagged some");
        assert_eq!(some.args()[1], json!(42));

        let none = ReducerCall::from_name(
            "create_workflow",
            json!([7, { "none": [] }, { "metadata": { "none": [] } }]),
        )
        .expect("tagged none");
        assert!(none.args()[1].is_null());

        assert!(matches!(
            ReducerCall::from_name(
                "create_workflow",
                json!([7, { "some": "wrong" }, { "metadata": { "none": [] } }])
            ),
            Err(ReducerContractError::WrongScalarKind { position: 1, .. })
        ));
    }

    #[test]
    fn normalizes_decimal_string_integer_inputs_from_json_bigints() {
        let publish = ReducerCall::from_name("publish_workflow_version", json!([7, "42", "3"]))
            .expect("decimal string ids");
        assert_eq!(publish.args(), &[json!(7), json!(42), json!(3)]);

        let workflow = ReducerCall::from_name(
            "create_workflow",
            json!([7, { "some": "42" }, { "metadata": { "none": [] } }]),
        )
        .expect("tagged decimal string id");
        assert_eq!(workflow.args()[1], json!(42));
    }
}
