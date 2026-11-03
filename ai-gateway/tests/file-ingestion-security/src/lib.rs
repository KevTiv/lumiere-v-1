//! Focused checks compile actual production modules, not copies of their logic.
//! The generated SDK and live network/store adapters are deliberately absent;
//! this suite cannot establish application wiring or deployed authorization.
#![allow(dead_code)]

extern crate self as stdb_client;

/// Unavailable transport stand-in. Production resolver tests use their own
/// authoritative fake through EvidenceAccess, never this client.
pub struct StdbClient;

impl StdbClient {
    pub async fn query_sql(&self, _query: &str) -> anyhow::Result<Vec<serde_json::Value>> {
        anyhow::bail!("live database transport is unavailable in focused checks")
    }
}

pub mod error {
    #[derive(Debug, thiserror::Error)]
    pub enum AppError {
        #[error("{0}")]
        Forbidden(String),
        #[error("{0}")]
        Unavailable(String),
    }
    pub type AppResult<T> = Result<T, AppError>;
}

pub mod state {
    pub struct AppState;
}

/// Transport data shapes only; no authorization or filtering is reimplemented.
pub mod qdrant_client {
    #[derive(Debug, Clone)]
    pub struct SemanticIndexRecord {
        pub organization_id: u64,
        pub company_id: u64,
        pub resource_kind: String,
        pub resource_id: String,
        pub resource_version: String,
        pub source_fingerprint: String,
        pub embedding_model: String,
        pub indexed_at: String,
        pub tags: Vec<String>,
    }

    #[derive(Debug)]
    pub struct SearchResult {
        pub score: f32,
        pub record: SemanticIndexRecord,
    }
}

#[path = "../../../src/orchestrator/intelligence.rs"]
pub(crate) mod intelligence;
#[path = "../../../src/routes/passage_retrieval.rs"]
pub(crate) mod passage_retrieval;
#[path = "../../../src/routes/rag_context.rs"]
pub(crate) mod rag_context;

pub mod orchestrator {
    pub(crate) use crate::intelligence;
}

pub mod routes {
    pub(crate) use crate::passage_retrieval;

    pub mod evidence {
        use crate::{error::AppResult, state::AppState};

        #[derive(Debug, Clone, Copy)]
        pub struct CapabilityGrantBounds {
            pub max_rows: u64,
            pub max_bytes: u64,
        }

        pub const RAG_EVIDENCE_RETRIEVE_CAPABILITY: &str = "ai.evidence.retrieve";

        pub async fn require_scoped_capability_grant(
            _state: &AppState,
            _actor_identity: &str,
            _actor_token: &str,
            _organization_id: u64,
            _company_id: u64,
            _capability: &str,
        ) -> AppResult<CapabilityGrantBounds> {
            Err(crate::error::AppError::Unavailable(
                "live grant transport is unavailable in focused checks".into(),
            ))
        }
    }
}
