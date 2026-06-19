use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use stdb_client::StdbClient;

use crate::{
    harness::LiveSnapshot,
    providers::Providers,
    qdrant_client::VectorStore,
    rig_agent::RigContext,
    sandbox::{DatasetSpec, SandboxSession},
    state::AppState,
};

#[derive(Clone)]
pub struct ToolContext {
    pub state: AppState,
    pub stdb: Arc<StdbClient>,
    pub org_id: u64,
    pub company_id: u64,
    pub run_id: u64,
    pub skill_key: String,
    pub config_json: Value,
    pub inputs: Value,
    pub sandbox: Option<Arc<Mutex<SandboxSession>>>,
    pub dataset_specs: Vec<DatasetSpec>,
    pub allowed_action_drafts: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SkillCitation {
    pub kind: String,
    pub trust: String,
    pub content_type: Option<String>,
    pub entity_id: Option<String>,
    pub score: Option<f32>,
    pub text_snippet: Option<String>,
    pub label: Option<String>,
    pub snapshot_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ToolOutput {
    pub summary: String,
    pub data: Value,
    pub citations: Vec<SkillCitation>,
    pub row_count: Option<u32>,
}

pub type ToolResult = anyhow::Result<ToolOutput>;

pub fn hash_tool_input(input: &Value) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let normalized = serde_json::to_string(input).unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    normalized.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

impl ToolContext {
    pub fn providers(&self) -> &Providers {
        &self.state.providers
    }

    pub fn vector_store(&self) -> &Arc<VectorStore> {
        &self.state.vector_store
    }

    pub fn rig(&self) -> &Arc<RigContext> {
        &self.state.rig
    }
}

pub fn live_snapshot_citation(snapshot: &LiveSnapshot) -> SkillCitation {
    SkillCitation {
        kind: "live".to_string(),
        trust: "authoritative".to_string(),
        content_type: Some(snapshot.entity_type.clone()),
        entity_id: Some(snapshot.entity_id.to_string()),
        score: None,
        text_snippet: Some(snapshot.label.clone()),
        label: Some(snapshot.label.clone()),
        snapshot_at: Some(snapshot.snapshot_at.clone()),
        url: None,
        title: None,
        fetched_at: None,
    }
}
