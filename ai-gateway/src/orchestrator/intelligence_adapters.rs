//! GP-02 (governed intelligence program): LLM adapters over the GP-01
//! contracts.
//!
//! ```text
//! DecisionProvider  -> LlmDecisionAdapter  -> existing LlmCompletion transport
//! ReasoningProvider -> AgentLoopReasoner   -> existing LlmCompletion transport
//! GenerationProvider -> LlmGenerationAdapter -> existing LlmCompletion transport
//! ```
//!
//! These adapters do not add a new provider crate/SDK: they reuse the
//! existing `LlmCompletion`/`LlmRequest`/`ToolSpec` transport and force
//! structured output through the same tool-calling wire format the agent
//! loop already uses. A malformed or ambiguous typed response is a terminal
//! error, never a best-effort parse or a retry.
//!
//! No production route switch: nothing outside this module and its tests
//! constructs these adapters yet. Durability of provider attempts/usage is
//! inherited for free from whatever `LlmCompletion` the caller supplies —
//! in production that is `SpendAdmittedLlm` (`spend_admission.rs`), which
//! already reserves/accepts/records every call. These adapters never see or
//! bypass that layer; they are transport-agnostic over the trait.

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use super::intelligence::{
    CapabilityProposal, ClarificationRequest, DecisionKind, DecisionProposal, DecisionProvider,
    DecisionRequest, DecisionResponse, DecisionTypeRef, FinalDraft, GenerationProvider,
    GenerationRequest, GenerationResponse, ProgramPatchProposal, ReasoningOutcome,
    ReasoningProvider, ReasoningRequest, UnableToProgress, PROPOSAL_KIND_CAPABILITY,
    PROPOSAL_KIND_CLARIFICATION, PROPOSAL_KIND_DECISION, PROPOSAL_KIND_FINAL_DRAFT,
    PROPOSAL_KIND_PROGRAM_PATCH,
};
use super::model_configuration::ModelProfile;
use crate::providers::llm::{LlmCompletion, LlmMessage, LlmRequest, ToolCallRequest, ToolSpec};

const DECISION_TOOL: &str = "submit_decision";
const TOOL_UNABLE_TO_PROGRESS: &str = "report_unable_to_progress";
const TOOL_PROPOSE_DECISION: &str = "propose_decision";
const TOOL_PROPOSE_CAPABILITY: &str = "propose_capability";
const TOOL_PROPOSE_PROGRAM_PATCH: &str = "propose_program_patch";
const TOOL_REQUEST_CLARIFICATION: &str = "request_clarification";
const TOOL_SUBMIT_FINAL_DRAFT: &str = "submit_final_draft";

/// `DecisionProvider` implemented over the existing `LlmCompletion` transport.
/// Forces the model to answer through a single typed tool call rather than
/// free-text so this adapter has no freeform-JSON parser to fool.
pub(super) struct LlmDecisionAdapter<'a> {
    transport: &'a dyn LlmCompletion,
    provider: String,
    model: String,
    max_tokens: u32,
    temperature: Option<f64>,
    top_p: Option<f64>,
}

impl<'a> LlmDecisionAdapter<'a> {
    pub fn new(transport: &'a dyn LlmCompletion, provider: String, model: String) -> Self {
        Self {
            transport,
            provider,
            model,
            max_tokens: 512,
            temperature: Some(0.0),
            top_p: None,
        }
    }

    pub fn from_profile(transport: &'a dyn LlmCompletion, profile: &ModelProfile) -> Self {
        Self {
            transport,
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            max_tokens: profile.max_tokens.min(512),
            temperature: profile.temperature.or(Some(0.0)),
            top_p: profile.top_p,
        }
    }
}

#[async_trait]
impl DecisionProvider for LlmDecisionAdapter<'_> {
    async fn decide(&self, request: DecisionRequest) -> Result<DecisionResponse> {
        request.validate().context("invalid decision request")?;

        let tool = decision_tool_spec(&request);
        let system = decision_system_prompt(&request);
        let llm_request = LlmRequest {
            provider: self.provider.clone(),
            model: self.model.clone(),
            system,
            messages: vec![LlmMessage::text("user", request.question.clone())],
            max_tokens: request.max_tokens.unwrap_or(self.max_tokens).min(self.max_tokens),
            temperature: self.temperature,
            top_p: self.top_p,
            tools: vec![tool],
        };

        let response = self.transport.complete(llm_request).await?;
        let call = single_call(&response.tool_calls, DECISION_TOOL)?;
        let args = object_arguments(call)?;

        let decision_response = match request.kind {
            DecisionKind::Choice => DecisionResponse {
                kind: DecisionKind::Choice,
                choice: Some(required_str(args, "choice")?),
                score: None,
                probability: None,
                confidence: optional_bounded_f64(args, "confidence")?,
                rationale: optional_str(args, "rationale"),
                model: response.model,
                provider: response.provider,
                input_tokens: response.input_tokens,
                output_tokens: response.output_tokens,
            },
            DecisionKind::Score => DecisionResponse {
                kind: DecisionKind::Score,
                choice: None,
                score: Some(required_f64(args, "score")?),
                probability: None,
                confidence: optional_bounded_f64(args, "confidence")?,
                rationale: optional_str(args, "rationale"),
                model: response.model,
                provider: response.provider,
                input_tokens: response.input_tokens,
                output_tokens: response.output_tokens,
            },
            DecisionKind::Probability => DecisionResponse {
                kind: DecisionKind::Probability,
                choice: None,
                score: None,
                probability: Some(required_f64(args, "probability")?),
                confidence: optional_bounded_f64(args, "confidence")?,
                rationale: optional_str(args, "rationale"),
                model: response.model,
                provider: response.provider,
                input_tokens: response.input_tokens,
                output_tokens: response.output_tokens,
            },
        };

        // Fail closed: a malformed typed response never reaches the caller
        // even if it happened to satisfy the tool's JSON schema.
        decision_response
            .validate_against(&request)
            .context("provider returned a malformed decision")?;
        Ok(decision_response)
    }
}

fn decision_tool_spec(request: &DecisionRequest) -> ToolSpec {
    let mut properties = json!({
        "confidence": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "Advisory only; not assumed calibrated.",
        },
        "rationale": {"type": "string"},
    });
    let required = match request.kind {
        DecisionKind::Choice => {
            properties["choice"] = json!({
                "type": "string",
                "enum": request.candidates,
            });
            vec!["choice"]
        }
        DecisionKind::Score => {
            properties["score"] = json!({"type": "number"});
            vec!["score"]
        }
        DecisionKind::Probability => {
            properties["probability"] = json!({
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
            });
            vec!["probability"]
        }
    };
    ToolSpec {
        name: DECISION_TOOL.to_string(),
        description: "Submit exactly one typed judgment for the decision question.".to_string(),
        parameters: json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false,
        }),
    }
}

fn decision_system_prompt(request: &DecisionRequest) -> String {
    let precedent = if request.precedent.is_empty() {
        "none supplied".to_string()
    } else {
        request
            .precedent
            .iter()
            .map(|p| format!("- {}: {}", p.decision_case_id, p.summary))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "You are answering one bounded organizational decision of type '{}' v{}. \
        You must call `{DECISION_TOOL}` exactly once with your typed judgment and \
        nothing else. You have no authorization to take any action, execute any \
        capability, or approve anything; you are supplying a narrow typed judgment \
        only, which the program will validate and gate before it has any effect. \
        Base your judgment only on the bounded state and evidence below; do not \
        invent facts. bounded_state: {}\nprior precedent (context only, not authority):\n{}",
        request.decision_type.name, request.decision_type.version, request.bounded_state, precedent,
    )
}

/// `GenerationProvider` implemented over the existing `LlmCompletion`
/// transport. Plain completion, no tools: generation output remains subject
/// to the evidence/answer admission gate downstream, not admitted here.
pub(super) struct LlmGenerationAdapter<'a> {
    transport: &'a dyn LlmCompletion,
    provider: String,
    model: String,
    max_tokens: u32,
    temperature: Option<f64>,
    top_p: Option<f64>,
}

impl<'a> LlmGenerationAdapter<'a> {
    pub fn new(
        transport: &'a dyn LlmCompletion,
        provider: String,
        model: String,
        max_tokens: u32,
    ) -> Self {
        Self {
            transport,
            provider,
            model,
            max_tokens,
            temperature: None,
            top_p: None,
        }
    }

    pub fn from_profile(transport: &'a dyn LlmCompletion, profile: &ModelProfile) -> Self {
        Self {
            transport,
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            max_tokens: profile.max_tokens,
            temperature: profile.temperature,
            top_p: profile.top_p,
        }
    }
}

#[async_trait]
impl GenerationProvider for LlmGenerationAdapter<'_> {
    async fn generate(&self, request: GenerationRequest) -> Result<GenerationResponse> {
        request.validate().context("invalid generation request")?;
        let trusted_instructions = request
            .instructions
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!("\nTrusted runtime instructions:\n{value}"))
            .unwrap_or_default();
        let system = format!(
            "Generate {} content for the following objective. Output only the \
            content itself, with no preamble. This output is a draft: it remains \
            subject to evidence and publication gates before it may be presented \
            as approved.{trusted_instructions}\nobjective: {}\ncontext: {}",
            request.format, request.objective, request.context,
        );
        let llm_request = LlmRequest {
            provider: self.provider.clone(),
            model: self.model.clone(),
            system,
            messages: vec![LlmMessage::text("user", request.objective.clone())],
            max_tokens: request.max_tokens.unwrap_or(self.max_tokens).min(self.max_tokens),
            temperature: self.temperature,
            top_p: self.top_p,
            tools: Vec::new(),
        };
        let response = self.transport.complete(llm_request).await?;
        if !response.tool_calls.is_empty() {
            bail!("generation response must not include tool calls");
        }
        if response.text.trim().is_empty() {
            bail!("generation response content must be nonempty");
        }
        Ok(GenerationResponse {
            content: response.text,
            model: response.model,
            provider: response.provider,
            input_tokens: response.input_tokens,
            output_tokens: response.output_tokens,
        })
    }
}

/// `ReasoningProvider` implemented over the existing `LlmCompletion`
/// transport. Offers one tool per admitted proposal kind plus the always-on
/// unable-to-progress escape hatch; a response is accepted only if it picks
/// exactly one of those tools and the arguments satisfy `ReasoningOutcome`
/// validation.
pub(super) struct AgentLoopReasoner<'a> {
    transport: &'a dyn LlmCompletion,
    provider: String,
    model: String,
    max_tokens: u32,
    temperature: Option<f64>,
    top_p: Option<f64>,
}

impl<'a> AgentLoopReasoner<'a> {
    pub fn new(transport: &'a dyn LlmCompletion, provider: String, model: String) -> Self {
        Self {
            transport,
            provider,
            model,
            max_tokens: 1024,
            temperature: Some(0.2),
            top_p: None,
        }
    }

    pub fn from_profile(transport: &'a dyn LlmCompletion, profile: &ModelProfile) -> Self {
        Self {
            transport,
            provider: profile.provider.clone(),
            model: profile.model.clone(),
            max_tokens: profile.max_tokens.min(1024),
            temperature: profile.temperature.or(Some(0.2)),
            top_p: profile.top_p,
        }
    }
}

#[async_trait]
impl ReasoningProvider for AgentLoopReasoner<'_> {
    async fn reason(&self, request: ReasoningRequest) -> Result<ReasoningOutcome> {
        request.validate().context("invalid reasoning request")?;

        let tools = reasoning_tool_specs(&request);
        let system = reasoning_system_prompt(&request);
        let llm_request = LlmRequest {
            provider: self.provider.clone(),
            model: self.model.clone(),
            system,
            messages: vec![LlmMessage::text("user", request.objective.clone())],
            max_tokens: self.max_tokens,
            temperature: self.temperature,
            top_p: self.top_p,
            tools,
        };

        let response = self.transport.complete(llm_request).await?;
        if response.tool_calls.len() != 1 {
            bail!(
                "reasoning response must contain exactly one tool call, got {}",
                response.tool_calls.len()
            );
        }
        let call = &response.tool_calls[0];
        if let Some(error) = &call.arguments_error {
            bail!("reasoning response tool call had malformed arguments: {error}");
        }
        let args = call
            .arguments
            .as_object()
            .context("reasoning tool call arguments must be a JSON object")?;

        let outcome = match call.name.as_str() {
            TOOL_PROPOSE_DECISION => {
                ReasoningOutcome::DecisionProposal(parse_decision_proposal(args)?)
            }
            TOOL_PROPOSE_CAPABILITY => ReasoningOutcome::CapabilityProposal(CapabilityProposal {
                capability: required_str(args, "capability")?,
                arguments: args.get("arguments").cloned().unwrap_or_else(|| json!({})),
                rationale: optional_str(args, "rationale"),
            }),
            TOOL_PROPOSE_PROGRAM_PATCH => {
                ReasoningOutcome::ProgramPatchProposal(ProgramPatchProposal {
                    description: required_str(args, "description")?,
                    patch: args.get("patch").cloned().unwrap_or_else(|| json!({})),
                })
            }
            TOOL_REQUEST_CLARIFICATION => {
                ReasoningOutcome::ClarificationRequest(ClarificationRequest {
                    prompt: required_str(args, "prompt")?,
                    options: optional_str_array(args, "options"),
                    required: args
                        .get("required")
                        .and_then(Value::as_bool)
                        .unwrap_or(true),
                })
            }
            TOOL_SUBMIT_FINAL_DRAFT => ReasoningOutcome::FinalDraft(parse_final_draft(args)?),
            TOOL_UNABLE_TO_PROGRESS => ReasoningOutcome::UnableToProgress(UnableToProgress {
                reason: required_str(args, "reason")?,
                last_step_no: args
                    .get("last_step_no")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32,
            }),
            other => bail!("reasoning response used an unoffered tool '{other}'"),
        };

        // Fail closed against both malformed shape and a kind the step never
        // admitted, even if the model somehow named an offered tool for it.
        outcome
            .validate_against(&request)
            .context("provider returned a malformed or unadmitted reasoning outcome")?;
        Ok(outcome)
    }
}

/// Parses `submit_final_draft` arguments. Structured fields the model got
/// wrong fail the whole outcome (fail closed, like every other reasoning
/// outcome) rather than being silently dropped — a dropped claim or
/// calculation would look like a draft that never made one.
fn parse_final_draft(args: &serde_json::Map<String, Value>) -> Result<FinalDraft> {
    fn optional_typed<T: serde::de::DeserializeOwned>(
        args: &serde_json::Map<String, Value>,
        key: &str,
    ) -> Result<Vec<T>> {
        match args.get(key) {
            None | Some(Value::Null) => Ok(Vec::new()),
            Some(value) => serde_json::from_value(value.clone())
                .with_context(|| format!("final draft '{key}' is malformed")),
        }
    }
    Ok(FinalDraft {
        content: required_str(args, "content")?,
        citations: optional_typed(args, "citations")?,
        claims: optional_typed(args, "claims")?,
        calculations: optional_typed(args, "calculations")?,
    })
}

fn parse_decision_proposal(args: &serde_json::Map<String, Value>) -> Result<DecisionProposal> {
    let decision_type = DecisionTypeRef {
        name: required_str(args, "decision_type_name")?,
        version: args
            .get("decision_type_version")
            .and_then(Value::as_u64)
            .context("decision proposal missing decision_type_version")? as u32,
    };
    let kind_str = required_str(args, "kind")?;
    let kind = match kind_str.as_str() {
        "choice" => DecisionKind::Choice,
        "score" => DecisionKind::Score,
        "probability" => DecisionKind::Probability,
        other => bail!("decision proposal has unknown kind '{other}'"),
    };
    Ok(DecisionProposal {
        decision_type,
        kind,
        proposed_choice: optional_str(args, "proposed_choice"),
        proposed_score: args.get("proposed_score").and_then(Value::as_f64),
        proposed_probability: args.get("proposed_probability").and_then(Value::as_f64),
        rationale: optional_str(args, "rationale"),
    })
}

fn reasoning_tool_specs(request: &ReasoningRequest) -> Vec<ToolSpec> {
    let mut specs = Vec::with_capacity(request.allowed_proposal_kinds.len() + 1);
    for kind in &request.allowed_proposal_kinds {
        let spec = match kind.as_str() {
            PROPOSAL_KIND_DECISION => ToolSpec {
                name: TOOL_PROPOSE_DECISION.to_string(),
                description: "Propose a resolution to a typed decision. Does not execute; \
                    returns through normal decision validation and gates."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "decision_type_name": {"type": "string"},
                        "decision_type_version": {"type": "integer", "minimum": 1},
                        "kind": {"type": "string", "enum": ["choice", "score", "probability"]},
                        "proposed_choice": {"type": "string"},
                        "proposed_score": {"type": "number"},
                        "proposed_probability": {"type": "number", "minimum": 0.0, "maximum": 1.0},
                        "rationale": {"type": "string"},
                    },
                    "required": ["decision_type_name", "decision_type_version", "kind"],
                    "additionalProperties": false,
                }),
            },
            PROPOSAL_KIND_CAPABILITY => ToolSpec {
                name: TOOL_PROPOSE_CAPABILITY.to_string(),
                description: "Propose invoking one generated ERP capability. Does not \
                    execute; returns through normal authorization, policy and spend \
                    admission before anything runs."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "capability": {"type": "string"},
                        "arguments": {"type": "object"},
                        "rationale": {"type": "string"},
                    },
                    "required": ["capability", "arguments"],
                    "additionalProperties": false,
                }),
            },
            PROPOSAL_KIND_PROGRAM_PATCH => ToolSpec {
                name: TOOL_PROPOSE_PROGRAM_PATCH.to_string(),
                description: "Propose a structural change to the typed program graph. \
                    Interpreted and validated by the governed program, never applied \
                    directly."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "description": {"type": "string"},
                        "patch": {"type": "object"},
                    },
                    "required": ["description"],
                    "additionalProperties": false,
                }),
            },
            PROPOSAL_KIND_CLARIFICATION => ToolSpec {
                name: TOOL_REQUEST_CLARIFICATION.to_string(),
                description: "Ask a durable clarifying question when required state \
                    cannot be resolved from bounded_state, precedent or evidence."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "prompt": {"type": "string"},
                        "options": {"type": "array", "items": {"type": "string"}},
                        "required": {"type": "boolean"},
                    },
                    "required": ["prompt"],
                    "additionalProperties": false,
                }),
            },
            PROPOSAL_KIND_FINAL_DRAFT => ToolSpec {
                name: TOOL_SUBMIT_FINAL_DRAFT.to_string(),
                description: "Submit a candidate final answer. Still subject to the \
                    evidence/answer admission gate before it may be presented as \
                    complete."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "content": {"type": "string"},
                        "citations": {
                            "type": "array",
                            "description": "Run-level evidence refs the answer relies on.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "kind": {"type": "string"},
                                    "id": {"type": "string"},
                                },
                                "required": ["kind", "id"],
                                "additionalProperties": false,
                            },
                        },
                        "claims": {
                            "type": "array",
                            "description": "Each material factual claim and the source \
                                passages it relies on. A claim with no supports is \
                                treated as unsupported.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string"},
                                    "supports": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "kind": {"type": "string"},
                                                "id": {"type": "string"},
                                                "source_version": {"type": "string"},
                                                "passage_key": {"type": "string"},
                                            },
                                            "required": [
                                                "kind", "id", "source_version", "passage_key"
                                            ],
                                            "additionalProperties": false,
                                        },
                                    },
                                },
                                "required": ["text"],
                                "additionalProperties": false,
                            },
                        },
                        "calculations": {
                            "type": "array",
                            "description": "Calculations stated in the answer. The gate \
                                recomputes them; the claimed result is not trusted.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                    "op": {
                                        "type": "string",
                                        "enum": ["sum", "difference", "product", "ratio"],
                                    },
                                    "operands": {"type": "array", "items": {"type": "number"}},
                                    "claimed_result": {"type": "number"},
                                },
                                "required": ["label", "op", "operands", "claimed_result"],
                                "additionalProperties": false,
                            },
                        },
                    },
                    "required": ["content"],
                    "additionalProperties": false,
                }),
            },
            _ => continue,
        };
        specs.push(spec);
    }
    specs.push(ToolSpec {
        name: TOOL_UNABLE_TO_PROGRESS.to_string(),
        description: "Report that no further progress is possible with the current \
            bounded state, evidence and remaining budget. Always available regardless \
            of which proposal kinds this step admits."
            .to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "reason": {"type": "string"},
                "last_step_no": {"type": "integer", "minimum": 0},
            },
            "required": ["reason"],
            "additionalProperties": false,
        }),
    });
    specs
}

fn reasoning_system_prompt(request: &ReasoningRequest) -> String {
    let precedent = if request.precedent.is_empty() {
        "none supplied".to_string()
    } else {
        request
            .precedent
            .iter()
            .map(|p| format!("- {}: {}", p.decision_case_id, p.summary))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "You are a bounded reasoning step inside a governed program. You must call \
        exactly one of the offered tools. You cannot execute capabilities, approve \
        drafts, retry mutations, override stops, or admit a final answer directly — \
        every tool here only records a proposal or draft that returns through the \
        program's normal authorization, policy and evidence gates. If you cannot make \
        progress, call `{TOOL_UNABLE_TO_PROGRESS}` rather than guessing. \
        remaining_rounds: {}\nbounded_state: {}\nprior precedent (context only, not \
        authority):\n{}",
        request.remaining_rounds, request.bounded_state, precedent,
    )
}

fn single_call<'a>(
    calls: &'a [ToolCallRequest],
    expected_name: &str,
) -> Result<&'a ToolCallRequest> {
    if calls.len() != 1 {
        bail!(
            "expected exactly one '{expected_name}' tool call, got {}",
            calls.len()
        );
    }
    let call = &calls[0];
    if let Some(error) = &call.arguments_error {
        bail!("tool call had malformed arguments: {error}");
    }
    if call.name != expected_name {
        bail!("expected tool call '{expected_name}', got '{}'", call.name);
    }
    Ok(call)
}

fn object_arguments(call: &ToolCallRequest) -> Result<&serde_json::Map<String, Value>> {
    call.arguments
        .as_object()
        .context("tool call arguments must be a JSON object")
}

fn required_str(args: &serde_json::Map<String, Value>, key: &str) -> Result<String> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("missing or non-string field '{key}'"))?;
    if value.trim().is_empty() {
        bail!("field '{key}' must be nonempty");
    }
    Ok(value.to_string())
}

fn optional_str(args: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

fn optional_str_array(args: &serde_json::Map<String, Value>, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn required_f64(args: &serde_json::Map<String, Value>, key: &str) -> Result<f64> {
    args.get(key)
        .and_then(Value::as_f64)
        .with_context(|| format!("missing or non-numeric field '{key}'"))
}

fn optional_bounded_f64(args: &serde_json::Map<String, Value>, key: &str) -> Result<Option<f64>> {
    match args.get(key) {
        None => Ok(None),
        Some(value) => {
            let number = value
                .as_f64()
                .with_context(|| format!("field '{key}' must be numeric"))?;
            if !(0.0..=1.0).contains(&number) {
                bail!("field '{key}' must be within [0, 1]");
            }
            Ok(Some(number))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use crate::providers::llm::LlmResponse;

    struct ScriptedLlm {
        responses: Mutex<Vec<Result<LlmResponse, String>>>,
        last_request: Mutex<Option<LlmRequest>>,
    }

    impl ScriptedLlm {
        fn new(responses: Vec<LlmResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().map(Ok).rev().collect()),
                last_request: Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl LlmCompletion for ScriptedLlm {
        async fn complete(&self, req: LlmRequest) -> Result<LlmResponse> {
            *self.last_request.lock().unwrap() = Some(req);
            match self.responses.lock().unwrap().pop() {
                Some(Ok(response)) => Ok(response),
                Some(Err(message)) => Err(anyhow::anyhow!(message)),
                None => panic!("scripted transport exhausted"),
            }
        }
    }

    fn base_response() -> LlmResponse {
        LlmResponse {
            text: String::new(),
            input_tokens: 12,
            output_tokens: 8,
            model: "mistral-large-latest".to_string(),
            provider: "mistral".to_string(),
            tool_calls: Vec::new(),
        }
    }

    fn tool_call(name: &str, arguments: Value) -> ToolCallRequest {
        ToolCallRequest {
            id: Some("call-1".to_string()),
            name: name.to_string(),
            arguments,
            arguments_error: None,
        }
    }

    fn choice_request() -> DecisionRequest {
        DecisionRequest {
            decision_type: DecisionTypeRef {
                name: "PaymentDisposition".to_string(),
                version: 1,
            },
            kind: DecisionKind::Choice,
            question: "Should this payment be flagged?".to_string(),
            bounded_state: json!({"amount": 100}),
            candidates: vec!["flag".to_string(), "clear".to_string()],
            precedent: vec![],
            evidence: vec![],
        }
    }

    #[tokio::test]
    async fn decision_adapter_maps_a_valid_choice_response() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            DECISION_TOOL,
            json!({"choice": "flag", "confidence": 0.8, "rationale": "amount is unusual"}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let decision = adapter.decide(choice_request()).await.unwrap();
        assert_eq!(decision.choice.as_deref(), Some("flag"));
        assert_eq!(decision.confidence, Some(0.8));
        assert_eq!(decision.provider, "mistral");

        let sent = transport.last_request.lock().unwrap().clone().unwrap();
        assert_eq!(sent.tools.len(), 1);
        assert_eq!(sent.tools[0].name, DECISION_TOOL);
    }

    #[tokio::test]
    async fn decision_adapter_fails_closed_on_choice_outside_candidates() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(DECISION_TOOL, json!({"choice": "neither"}))];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        assert!(adapter.decide(choice_request()).await.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_fails_closed_on_missing_tool_call() {
        let transport = ScriptedLlm::new(vec![base_response()]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        assert!(adapter.decide(choice_request()).await.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_fails_closed_on_multiple_tool_calls() {
        let mut response = base_response();
        response.tool_calls = vec![
            tool_call(DECISION_TOOL, json!({"choice": "flag"})),
            tool_call(DECISION_TOOL, json!({"choice": "clear"})),
        ];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        assert!(adapter.decide(choice_request()).await.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_fails_closed_on_wrong_tool_name() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call("some_other_tool", json!({"choice": "flag"}))];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        assert!(adapter.decide(choice_request()).await.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_fails_closed_on_out_of_range_confidence() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            DECISION_TOOL,
            json!({"choice": "flag", "confidence": 1.4}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        assert!(adapter.decide(choice_request()).await.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_rejects_malformed_arguments_from_transport() {
        let mut response = base_response();
        let mut call = tool_call(DECISION_TOOL, Value::Null);
        call.arguments_error = Some("truncated json".to_string());
        response.tool_calls = vec![call];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        assert!(adapter.decide(choice_request()).await.is_err());
    }

    fn reasoning_request(kinds: Vec<&str>) -> ReasoningRequest {
        ReasoningRequest {
            objective: "investigate a stalled purchase order".to_string(),
            bounded_state: json!({"po_id": 42}),
            precedent: vec![],
            allowed_proposal_kinds: kinds.into_iter().map(str::to_string).collect(),
            remaining_rounds: 3,
        }
    }

    #[tokio::test]
    async fn reasoner_maps_capability_proposal() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_PROPOSE_CAPABILITY,
            json!({"capability": "erp.search", "arguments": {"q": "PO-42"}}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_CAPABILITY]))
            .await
            .unwrap();
        match outcome {
            ReasoningOutcome::CapabilityProposal(proposal) => {
                assert_eq!(proposal.capability, "erp.search");
            }
            other => panic!("unexpected outcome {other:?}"),
        }

        let sent = transport.last_request.lock().unwrap().clone().unwrap();
        // capability kind + the always-on unable-to-progress escape hatch.
        assert_eq!(sent.tools.len(), 2);
    }

    #[tokio::test]
    async fn reasoner_rejects_a_tool_call_outside_admitted_kinds() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_SUBMIT_FINAL_DRAFT,
            json!({"content": "done"}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        // final_draft was never offered, so the model could only have picked
        // it by ignoring the tool list; still must fail closed.
        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_CLARIFICATION]))
            .await;
        assert!(outcome.is_err());
    }

    #[tokio::test]
    async fn reasoner_always_accepts_unable_to_progress() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_UNABLE_TO_PROGRESS,
            json!({"reason": "no further evidence available", "last_step_no": 4}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_CLARIFICATION]))
            .await
            .unwrap();
        assert!(matches!(outcome, ReasoningOutcome::UnableToProgress(_)));
    }

    #[tokio::test]
    async fn reasoner_fails_closed_on_zero_tool_calls() {
        let transport = ScriptedLlm::new(vec![base_response()]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_FINAL_DRAFT]))
            .await;
        assert!(outcome.is_err());
    }

    #[tokio::test]
    async fn reasoner_maps_clarification_request() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_REQUEST_CLARIFICATION,
            json!({"prompt": "which vendor?", "options": ["A", "B"], "required": true}),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_CLARIFICATION]))
            .await
            .unwrap();
        match outcome {
            ReasoningOutcome::ClarificationRequest(request) => {
                assert_eq!(request.options, vec!["A".to_string(), "B".to_string()]);
                assert!(request.required);
            }
            other => panic!("unexpected outcome {other:?}"),
        }
    }

    #[tokio::test]
    async fn reasoner_maps_decision_proposal() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_PROPOSE_DECISION,
            json!({
                "decision_type_name": "SupplierRisk",
                "decision_type_version": 2,
                "kind": "probability",
                "proposed_probability": 0.6,
            }),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_DECISION]))
            .await
            .unwrap();
        match outcome {
            ReasoningOutcome::DecisionProposal(proposal) => {
                assert_eq!(proposal.decision_type.name, "SupplierRisk");
                assert_eq!(proposal.proposed_probability, Some(0.6));
            }
            other => panic!("unexpected outcome {other:?}"),
        }
    }

    #[tokio::test]
    async fn reasoner_fails_closed_on_invalid_decision_proposal_shape() {
        let mut response = base_response();
        response.tool_calls = vec![tool_call(
            TOOL_PROPOSE_DECISION,
            json!({
                "decision_type_name": "SupplierRisk",
                "decision_type_version": 2,
                "kind": "probability",
                "proposed_probability": 4.0,
            }),
        )];
        let transport = ScriptedLlm::new(vec![response]);
        let reasoner = AgentLoopReasoner::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );

        let outcome = reasoner
            .reason(reasoning_request(vec![PROPOSAL_KIND_DECISION]))
            .await;
        assert!(outcome.is_err());
    }

    #[tokio::test]
    async fn generation_adapter_returns_text_content() {
        let mut response = base_response();
        response.text = "Draft summary of the quarter.".to_string();
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmGenerationAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
            256,
        );
        let result = adapter
            .generate(GenerationRequest {
                objective: "summarize Q3 sales".to_string(),
                context: json!({"quarter": "Q3"}),
                format: "prose".to_string(),
                instructions: None,
                max_tokens: None,
            })
            .await
            .unwrap();
        assert_eq!(result.content, "Draft summary of the quarter.");
    }

    #[tokio::test]
    async fn generation_adapter_fails_closed_on_empty_content() {
        let transport = ScriptedLlm::new(vec![base_response()]);
        let adapter = LlmGenerationAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
            256,
        );
        let result = adapter
            .generate(GenerationRequest {
                objective: "summarize Q3 sales".to_string(),
                context: json!({}),
                format: "prose".to_string(),
                instructions: None,
                max_tokens: None,
            })
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn generation_adapter_fails_closed_on_unexpected_tool_calls() {
        let mut response = base_response();
        response.text = "some text".to_string();
        response.tool_calls = vec![tool_call("unexpected", json!({}))];
        let transport = ScriptedLlm::new(vec![response]);
        let adapter = LlmGenerationAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
            256,
        );
        let result = adapter
            .generate(GenerationRequest {
                objective: "summarize Q3 sales".to_string(),
                context: json!({}),
                format: "prose".to_string(),
                instructions: None,
                max_tokens: None,
            })
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn decision_adapter_propagates_transport_errors() {
        let transport = ScriptedLlm {
            responses: Mutex::new(vec![Err("provider timeout".to_string())]),
            last_request: Mutex::new(None),
        };
        let adapter = LlmDecisionAdapter::new(
            &transport,
            "mistral".to_string(),
            "mistral-large-latest".to_string(),
        );
        let result = adapter.decide(choice_request()).await;
        assert!(result.is_err());
    }
}
