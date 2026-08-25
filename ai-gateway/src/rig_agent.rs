/// RigContext — coordinator for the org-scoped AI context layer.
///
/// Wraps:
/// - `Providers` (embed, vision, parser) — swappable per config
/// - `qdrant_client::Client` — raw Qdrant client for the activities collection
///
/// All searches are scoped to both `organization_id` and `company_id`.
use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use qdrant_client::{
    qdrant::{
        r#match::MatchValue, Condition, CreateFieldIndexCollectionBuilder, Distance,
        FieldCondition, FieldType, Filter, Match, PointStruct, SearchPointsBuilder,
        UpsertPointsBuilder, VectorParamsBuilder, VectorsConfigBuilder,
    },
    Payload, Qdrant,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{config::Config, providers::Providers, qdrant_client::SemanticIndexRecord};

// ── Public types ──────────────────────────────────────────────────────────────

/// A single ERP activity to embed and store.
#[derive(Debug, Clone)]
pub struct Activity {
    pub org_id: u64,
    pub company_id: u64,
    pub entity_type: String, // "sale_order", "project_task", …
    pub entity_id: String,
    /// Used only to produce the embedding and fingerprint; never persisted.
    pub text: String,
    pub timestamp: i64, // unix micros
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct ActivityIndexRecord {
    #[serde(flatten)]
    pub semantic: SemanticIndexRecord,
    pub activity_timestamp: i64,
}

/// A reference-only hit returned from activity search.
#[derive(Debug, Clone, Serialize)]
pub struct ContextHit {
    pub score: f32,
    #[serde(flatten)]
    pub record: ActivityIndexRecord,
}

// ── RigContext ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct RigContext {
    pub providers: Providers,
    qdrant: Arc<Qdrant>,
    collection: String,
    embedding_model: String,
}

impl RigContext {
    pub async fn new(config: &Config, providers: Providers) -> Result<Self> {
        let qdrant = if let Some(key) = &config.qdrant_api_key {
            Qdrant::from_url(&config.qdrant_url)
                .api_key(key.clone())
                .build()?
        } else {
            Qdrant::from_url(&config.qdrant_url).build()?
        };

        Ok(RigContext {
            providers,
            qdrant: Arc::new(qdrant),
            collection: config.activity_refs_collection.clone(),
            embedding_model: config.embedding_model_name(),
        })
    }

    /// Create the Qdrant collection + payload indexes if they don't exist.
    pub fn collection_name(&self) -> &str {
        &self.collection
    }

    pub async fn ensure_collection(&self) -> Result<()> {
        let dim = self.providers.embedder.dimensions();
        let exists = self.qdrant.collection_exists(&self.collection).await?;

        if !exists {
            let mut vectors_config = VectorsConfigBuilder::default();
            vectors_config.add_named_vector_params(
                "default",
                VectorParamsBuilder::new(dim, Distance::Cosine),
            );

            self.qdrant
                .create_collection(
                    qdrant_client::qdrant::CreateCollectionBuilder::new(&self.collection)
                        .vectors_config(vectors_config),
                )
                .await?;

            // Reference-only indexes for bounded organization/company searches.
            for (field, ftype) in [
                ("organization_id", FieldType::Integer),
                ("company_id", FieldType::Integer),
                ("resource_kind", FieldType::Keyword),
                ("resource_id", FieldType::Keyword),
                ("resource_version", FieldType::Keyword),
                ("activity_timestamp", FieldType::Integer),
            ] {
                self.qdrant
                    .create_field_index(CreateFieldIndexCollectionBuilder::new(
                        &self.collection,
                        field,
                        ftype,
                    ))
                    .await?;
            }

            tracing::info!(collection = %self.collection, dim, "Activity reference collection created");
        }

        Ok(())
    }

    /// Upsert a batch of activities efficiently.
    pub async fn upsert_activities(&self, activities: &[Activity]) -> Result<usize> {
        if activities.is_empty() {
            return Ok(0);
        }

        let texts: Vec<String> = activities.iter().map(|a| a.text.clone()).collect();
        let vectors = self.providers.embedder.embed_batch(&texts).await?;

        let points: Vec<PointStruct> = activities
            .iter()
            .zip(vectors.into_iter())
            .map(|(a, vector)| {
                let point_id = deterministic_id(
                    &a.org_id.to_string(),
                    &a.company_id.to_string(),
                    &a.entity_type,
                    &a.entity_id,
                );
                let record = activity_index_record(
                    a,
                    &self.embedding_model,
                    chrono::Utc::now().to_rfc3339(),
                );
                let payload = Payload::try_from(serde_json::to_value(record)?)?;
                Ok(PointStruct::new(
                    point_id.to_string(),
                    HashMap::from([("default".to_string(), vector)]),
                    payload,
                ))
            })
            .collect::<Result<Vec<_>>>()?;

        let count = points.len();
        self.qdrant
            .upsert_points(UpsertPointsBuilder::new(&self.collection, points))
            .await?;

        Ok(count)
    }

    /// Semantic search returns references only and always binds both tenant scopes.
    pub async fn search_scope(
        &self,
        org_id: u64,
        company_id: u64,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<ContextHit>> {
        if org_id == 0 || company_id == 0 {
            anyhow::bail!("organization and company scope are required");
        }
        let query_vector = self.providers.embedder.embed(query).await?;

        let filter = activity_scope_filter(org_id, company_id);

        let results = self
            .qdrant
            .search_points(
                SearchPointsBuilder::new(&self.collection, query_vector, top_k as u64)
                    .filter(filter)
                    .with_payload(true)
                    .vector_name("default"),
            )
            .await?;

        let hits = results
            .result
            .into_iter()
            .filter_map(|hit| {
                let record = activity_record_from_payload(&hit.payload)?;
                Some(ContextHit {
                    score: hit.score,
                    record,
                })
            })
            .collect();

        Ok(hits)
    }

}

fn payload_string(payload: &HashMap<String, qdrant_client::qdrant::Value>, key: &str) -> Option<String> {
    payload.get(key)?.as_str().cloned().filter(|value| !value.is_empty())
}

fn payload_u64(payload: &HashMap<String, qdrant_client::qdrant::Value>, key: &str) -> Option<u64> {
    u64::try_from(payload.get(key)?.as_integer()?).ok()
}

fn payload_strings(
    payload: &HashMap<String, qdrant_client::qdrant::Value>,
    key: &str,
) -> Option<Vec<String>> {
    payload
        .get(key)?
        .clone()
        .into_json()
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect()
}

fn activity_record_from_payload(
    payload: &HashMap<String, qdrant_client::qdrant::Value>,
) -> Option<ActivityIndexRecord> {
    Some(ActivityIndexRecord {
        semantic: SemanticIndexRecord {
            organization_id: payload_u64(payload, "organization_id")?,
            company_id: payload_u64(payload, "company_id")?,
            resource_kind: payload_string(payload, "resource_kind")?,
            resource_id: payload_string(payload, "resource_id")?,
            resource_version: payload_string(payload, "resource_version")?,
            source_fingerprint: payload_string(payload, "source_fingerprint")?,
            embedding_model: payload_string(payload, "embedding_model")?,
            indexed_at: payload_string(payload, "indexed_at")?,
            tags: payload_strings(payload, "tags")?,
        },
        activity_timestamp: payload.get("activity_timestamp")?.as_integer()?,
    })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deterministic UUID v5 from org + entity namespace. Ensures idempotent upserts.
fn deterministic_id(org_id: &str, company_id: &str, entity_type: &str, entity_id: &str) -> Uuid {
    let namespace = Uuid::NAMESPACE_OID;
    let key = format!("activity-ref:v1:{org_id}:{company_id}:{entity_type}:{entity_id}");
    Uuid::new_v5(&namespace, key.as_bytes())
}

fn activity_fingerprint(activity: &Activity) -> String {
    let mut hasher = Sha256::new();
    hasher.update(activity.org_id.to_le_bytes());
    hasher.update(activity.company_id.to_le_bytes());
    hasher.update(activity.entity_type.as_bytes());
    hasher.update(activity.entity_id.as_bytes());
    hasher.update(activity.timestamp.to_le_bytes());
    hasher.update(activity.text.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

fn activity_index_record(
    activity: &Activity,
    embedding_model: &str,
    indexed_at: String,
) -> ActivityIndexRecord {
    ActivityIndexRecord {
        semantic: SemanticIndexRecord {
            organization_id: activity.org_id,
            company_id: activity.company_id,
            resource_kind: activity.entity_type.clone(),
            resource_id: activity.entity_id.clone(),
            resource_version: activity.timestamp.to_string(),
            source_fingerprint: activity_fingerprint(activity),
            embedding_model: embedding_model.to_string(),
            indexed_at,
            tags: vec!["activity".to_string()],
        },
        activity_timestamp: activity.timestamp,
    }
}

fn integer_match(field: &str, value: u64) -> Condition {
    Condition {
        condition_one_of: Some(qdrant_client::qdrant::condition::ConditionOneOf::Field(
            FieldCondition {
                key: field.to_string(),
                r#match: Some(Match {
                    match_value: Some(MatchValue::Integer(value as i64)),
                }),
                ..Default::default()
            },
        )),
    }
}

fn activity_scope_filter(org_id: u64, company_id: u64) -> Filter {
    Filter {
        must: vec![
            integer_match("organization_id", org_id),
            integer_match("company_id", company_id),
        ],
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn activity() -> Activity {
        Activity {
            org_id: 7,
            company_id: 11,
            entity_type: "sale_order".into(),
            entity_id: "42".into(),
            text: "Sensitive transient embedding source".into(),
            timestamp: 123,
        }
    }

    #[test]
    fn activity_payload_is_reference_only() {
        let value = serde_json::to_value(activity_index_record(
            &activity(),
            "test-model",
            "2026-08-25T00:00:00Z".into(),
        ))
        .expect("record");
        assert!(value.get("text").is_none());
        assert!(value.get("filename").is_none());
        assert_eq!(value.get("organization_id").and_then(|v| v.as_u64()), Some(7));
        assert_eq!(value.get("company_id").and_then(|v| v.as_u64()), Some(11));
        assert_eq!(value.get("resource_id").and_then(|v| v.as_str()), Some("42"));
    }

    #[test]
    fn activity_point_identity_is_stable_and_company_distinct() {
        let a = deterministic_id("7", "11", "sale_order", "42");
        assert_eq!(a, deterministic_id("7", "11", "sale_order", "42"));
        assert_ne!(a, deterministic_id("7", "12", "sale_order", "42"));
    }

    #[test]
    fn activity_search_filter_binds_organization_and_company() {
        let filter = activity_scope_filter(7, 11);
        assert_eq!(filter.must.len(), 2);
        let keys = filter
            .must
            .into_iter()
            .filter_map(|condition| match condition.condition_one_of? {
                qdrant_client::qdrant::condition::ConditionOneOf::Field(field) => Some(field.key),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(keys.contains(&"organization_id".to_string()));
        assert!(keys.contains(&"company_id".to_string()));
    }
}
