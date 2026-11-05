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
        r#match::MatchValue, Condition, CreateFieldIndexCollectionBuilder, DeletePointsBuilder,
        Distance, FieldCondition, FieldType, Filter, GetPointsBuilder, Match, PointStruct,
        PointsIdsList, SearchPointsBuilder, UpsertPointsBuilder, VectorParamsBuilder,
        VectorsConfigBuilder,
    },
    Payload, Qdrant,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::harness::LiveSnapshot;
use crate::{config::Config, providers::Providers, qdrant_client::SemanticIndexRecord};

// ── Public types ──────────────────────────────────────────────────────────────

/// A single ERP activity to embed and store.
#[derive(Debug, Clone)]
pub struct Activity {
    pub org_id: u64,
    pub company_id: u64,
    pub actor_identity: String,
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
    pub actor_identity: String,
}

/// A reference-only hit returned from activity search.
#[derive(Debug, Clone, Serialize)]
pub struct ContextHit {
    pub score: f32,
    #[serde(flatten)]
    pub record: ActivityIndexRecord,
}

/// Construct embedding text only from the authoritative owner's current,
/// actor-filtered projection. Observation time is deliberately excluded.
pub(crate) fn activity_for_snapshot(
    org_id: u64,
    company_id: u64,
    actor_identity: &str,
    snapshot: &LiveSnapshot,
) -> Result<Activity> {
    if !snapshot.row.is_object() || snapshot.row.as_object().is_none_or(|row| row.is_empty()) {
        anyhow::bail!("activity projection has no authorized fields");
    }
    let text = serde_json::to_string(&serde_json::json!({
        "resource_kind": snapshot.entity_type,
        "resource_id": snapshot.entity_id.to_string(),
        "fields": snapshot.row,
    }))?;
    if text.len() > 16 * 1024 {
        anyhow::bail!("activity projection exceeds its byte bound");
    }
    Ok(Activity {
        org_id,
        company_id,
        actor_identity: actor_identity.to_owned(),
        entity_type: snapshot.entity_type.clone(),
        entity_id: snapshot.entity_id.to_string(),
        text,
        timestamp: chrono::Utc::now().timestamp_micros(),
    })
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
                ("actor_identity", FieldType::Keyword),
                ("embedding_model", FieldType::Keyword),
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
        self.check_ready().await
    }

    pub async fn check_ready(&self) -> Result<()> {
        let response = self.qdrant.collection_info(&self.collection).await?;
        let vectors = response
            .result
            .and_then(|info| info.config)
            .and_then(|config| config.params)
            .and_then(|params| params.vectors_config)
            .ok_or_else(|| anyhow::anyhow!("activity vector configuration is unavailable"))?;
        validate_activity_collection(&vectors, self.providers.embedder.dimensions())
    }

    /// Upsert a batch of activities efficiently.
    pub async fn upsert_activities(&self, activities: &[Activity]) -> Result<usize> {
        if activities.is_empty() {
            return Ok(0);
        }

        if self.providers.embedder.name() == "mistral" {
            anyhow::bail!("Mistral indexing requires admitted embedding vectors");
        }
        let texts: Vec<String> = activities.iter().map(|a| a.text.clone()).collect();
        let vectors = self.providers.embedder.embed_batch(&texts).await?;

        self.upsert_activities_with_vectors(activities, vectors)
            .await
    }

    /// Publish vectors only after the caller has admitted and settled their cost.
    pub async fn upsert_activities_with_vectors(
        &self,
        activities: &[Activity],
        vectors: Vec<Vec<f32>>,
    ) -> Result<usize> {
        validate_vectors(
            &vectors,
            activities.len(),
            self.providers.embedder.dimensions(),
        )?;
        if activities.is_empty() {
            return Ok(0);
        }

        let points: Vec<PointStruct> = activities
            .iter()
            .zip(vectors.into_iter())
            .map(|(a, vector)| {
                let point_id = deterministic_id(
                    &a.org_id.to_string(),
                    &a.company_id.to_string(),
                    &a.entity_type,
                    &a.entity_id,
                    &a.actor_identity,
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
            .upsert_points(UpsertPointsBuilder::new(&self.collection, points).wait(true))
            .await?;

        Ok(count)
    }

    /// Remove an explicitly selected reference after its authoritative owner no
    /// longer returns it. No source text or caller-selected collection is used.
    pub async fn delete_reference(
        &self,
        org_id: u64,
        company_id: u64,
        actor_identity: &str,
        kind: &str,
        id: &str,
    ) -> Result<()> {
        let point_id = deterministic_id(
            &org_id.to_string(),
            &company_id.to_string(),
            kind,
            id,
            actor_identity,
        );
        self.qdrant
            .delete_points(
                DeletePointsBuilder::new(&self.collection)
                    .points(PointsIdsList {
                        ids: vec![point_id.to_string().into()],
                    })
                    .wait(true),
            )
            .await?;
        Ok(())
    }

    /// Exact reference read prevents a status refresh from paying to embed
    /// unchanged content again. Legacy or another model's points never match.
    pub async fn activity_is_current(&self, activity: &Activity) -> Result<bool> {
        let id = deterministic_id(
            &activity.org_id.to_string(),
            &activity.company_id.to_string(),
            &activity.entity_type,
            &activity.entity_id,
            &activity.actor_identity,
        );
        let response = self
            .qdrant
            .get_points(
                GetPointsBuilder::new(&self.collection, vec![id.to_string().into()])
                    .with_payload(true),
            )
            .await?;
        Ok(response.result.first().is_some_and(|point| {
            scoped_activity_record_from_payload(
                &point.payload,
                activity.org_id,
                activity.company_id,
            )
            .is_some_and(|record| {
                record.actor_identity == activity.actor_identity
                    && record.semantic.source_fingerprint == activity_fingerprint(activity)
                    && record.semantic.embedding_model == self.embedding_model
            })
        }))
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
        if self.providers.embedder.name() == "mistral" {
            anyhow::bail!("Mistral retrieval requires an admitted query embedding");
        }
        let query_vector = self.providers.embedder.embed(query).await?;
        self.search_scope_with_vector(org_id, company_id, "legacy", query_vector, top_k)
            .await
    }

    /// Search using an already metered query vector. All candidates still need
    /// current actor authorization at the authoritative record owner.
    pub async fn search_scope_with_vector(
        &self,
        org_id: u64,
        company_id: u64,
        actor_identity: &str,
        query_vector: Vec<f32>,
        top_k: usize,
    ) -> Result<Vec<ContextHit>> {
        if org_id == 0 || company_id == 0 || !(1..=50).contains(&top_k) {
            anyhow::bail!("bounded organization and company scope are required");
        }
        validate_vectors(
            std::slice::from_ref(&query_vector),
            1,
            self.providers.embedder.dimensions(),
        )?;

        let mut filter = activity_scope_filter(org_id, company_id);
        filter.must.push(Condition::matches(
            "actor_identity",
            actor_identity.to_string(),
        ));
        filter.must.push(Condition::matches(
            "embedding_model",
            self.embedding_model.clone(),
        ));

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
                let record = scoped_activity_record_from_payload(&hit.payload, org_id, company_id)?;
                if record.semantic.embedding_model != self.embedding_model
                    || record.actor_identity != actor_identity
                {
                    return None;
                }
                Some(ContextHit {
                    score: hit.score,
                    record,
                })
            })
            .collect();

        Ok(hits)
    }
}

fn payload_string(
    payload: &HashMap<String, qdrant_client::qdrant::Value>,
    key: &str,
) -> Option<String> {
    payload
        .get(key)?
        .as_str()
        .cloned()
        .filter(|value| !value.is_empty())
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
    if ["text", "text_snippet", "content", "filename", "source"]
        .iter()
        .any(|key| payload.contains_key(*key))
    {
        return None;
    }

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
        actor_identity: payload_string(payload, "actor_identity")?,
    })
}

fn scoped_activity_record_from_payload(
    payload: &HashMap<String, qdrant_client::qdrant::Value>,
    organization_id: u64,
    company_id: u64,
) -> Option<ActivityIndexRecord> {
    let record = activity_record_from_payload(payload)?;
    (record.semantic.organization_id == organization_id && record.semantic.company_id == company_id)
        .then_some(record)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deterministic UUID v5 from org + entity namespace. Ensures idempotent upserts.
fn deterministic_id(
    org_id: &str,
    company_id: &str,
    entity_type: &str,
    entity_id: &str,
    actor: &str,
) -> Uuid {
    let namespace = Uuid::NAMESPACE_OID;
    let key = format!("activity-ref:v2:{org_id}:{company_id}:{actor}:{entity_type}:{entity_id}");
    Uuid::new_v5(&namespace, key.as_bytes())
}

pub(crate) fn activity_fingerprint(activity: &Activity) -> String {
    let mut hasher = Sha256::new();
    hasher.update(activity.org_id.to_le_bytes());
    hasher.update(activity.company_id.to_le_bytes());
    // An observation clock is not a source revision. Identical authorized
    // content must keep the same version across reloads and manual refreshes.
    for part in [
        activity.actor_identity.as_bytes(),
        activity.entity_type.as_bytes(),
        activity.entity_id.as_bytes(),
        activity.text.as_bytes(),
    ] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
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
            resource_version: activity_fingerprint(activity),
            source_fingerprint: activity_fingerprint(activity),
            embedding_model: embedding_model.to_string(),
            indexed_at,
            tags: vec!["activity".to_string()],
        },
        activity_timestamp: activity.timestamp,
        actor_identity: activity.actor_identity.clone(),
    }
}

fn validate_vectors(vectors: &[Vec<f32>], expected: usize, dimension: u64) -> Result<()> {
    if vectors.len() != expected
        || dimension == 0
        || vectors
            .iter()
            .any(|v| v.len() as u64 != dimension || v.iter().any(|value| !value.is_finite()))
    {
        anyhow::bail!("embedding vectors do not match the configured activity space");
    }
    Ok(())
}

fn validate_activity_collection(
    config: &qdrant_client::qdrant::VectorsConfig,
    dimension: u64,
) -> Result<()> {
    use qdrant_client::qdrant::vectors_config::Config;
    let Some(Config::ParamsMap(map)) = config.config.as_ref() else {
        anyhow::bail!("activity collection requires the named default vector");
    };
    let params = map
        .map
        .get("default")
        .ok_or_else(|| anyhow::anyhow!("activity default vector is unavailable"))?;
    if params.size != dimension || params.distance != Distance::Cosine as i32 {
        anyhow::bail!("activity collection requires migration to the configured embedding space");
    }
    Ok(())
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

    fn payload(
        organization_id: u64,
        company_id: u64,
    ) -> HashMap<String, qdrant_client::qdrant::Value> {
        Payload::try_from(serde_json::json!({
            "organization_id": organization_id,
            "company_id": company_id,
            "resource_kind": "sale_order",
            "resource_id": "42",
            "resource_version": "123",
            "source_fingerprint": "sha256:test",
            "embedding_model": "test-model",
            "indexed_at": "2026-08-25T00:00:00Z",
            "tags": ["activity"],
            "activity_timestamp": 123
            ,"actor_identity": "test-actor"
        }))
        .expect("payload")
        .into()
    }

    fn activity() -> Activity {
        Activity {
            org_id: 7,
            company_id: 11,
            actor_identity: "test-actor".into(),
            entity_type: "sale_order".into(),
            entity_id: "42".into(),
            text: "Sensitive transient embedding source".into(),
            timestamp: 123,
        }
    }

    #[test]
    fn projection_fingerprint_tracks_fields_and_actor_but_not_observation_time() {
        let mut snapshot = LiveSnapshot {
            entity_type: "sale_order".into(),
            entity_id: 42,
            label: "Sale order #42".into(),
            snapshot_at: "first".into(),
            row: serde_json::json!({"id": 42, "reference": "SO-42", "amount_total": 12}),
            relations: vec![],
        };
        let first = activity_for_snapshot(7, 11, "actor-a", &snapshot).unwrap();
        snapshot.snapshot_at = "later".into();
        let mut later = activity_for_snapshot(7, 11, "actor-a", &snapshot).unwrap();
        later.timestamp += 999;
        assert_eq!(activity_fingerprint(&first), activity_fingerprint(&later));
        assert_ne!(
            activity_fingerprint(&first),
            activity_fingerprint(&activity_for_snapshot(7, 11, "actor-b", &snapshot).unwrap())
        );
        snapshot.row.as_object_mut().unwrap().remove("amount_total");
        assert_ne!(
            activity_fingerprint(&first),
            activity_fingerprint(&activity_for_snapshot(7, 11, "actor-a", &snapshot).unwrap())
        );
        snapshot.row = serde_json::json!({});
        assert!(activity_for_snapshot(7, 11, "actor-a", &snapshot).is_err());
    }

    #[test]
    fn activity_space_rejects_legacy_dimensions_distance_and_bad_vectors() {
        use qdrant_client::qdrant::{
            vectors_config::Config, VectorParams, VectorParamsMap, VectorsConfig,
        };
        let params = |size, distance| VectorParams {
            size,
            distance,
            ..Default::default()
        };
        let named = |size, distance| VectorsConfig {
            config: Some(Config::ParamsMap(VectorParamsMap {
                map: HashMap::from([("default".into(), params(size, distance))]),
            })),
        };
        assert!(validate_activity_collection(&named(1024, Distance::Cosine as i32), 1024).is_ok());
        assert!(validate_activity_collection(&named(768, Distance::Cosine as i32), 1024).is_err());
        assert!(validate_activity_collection(&named(1024, Distance::Dot as i32), 1024).is_err());
        assert!(validate_activity_collection(
            &VectorsConfig {
                config: Some(Config::Params(params(1024, Distance::Cosine as i32)))
            },
            1024
        )
        .is_err());
        assert!(validate_vectors(&[vec![0.1, 0.2]], 1, 2).is_ok());
        assert!(validate_vectors(&[], 1, 2).is_err());
        assert!(validate_vectors(&[vec![0.1]], 1, 2).is_err());
        assert!(validate_vectors(&[vec![f32::NAN, 0.1]], 1, 2).is_err());
        assert!(validate_vectors(&[vec![f32::INFINITY, 0.1]], 1, 2).is_err());
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
        assert_eq!(
            value.get("organization_id").and_then(|v| v.as_u64()),
            Some(7)
        );
        assert_eq!(value.get("company_id").and_then(|v| v.as_u64()), Some(11));
        assert_eq!(
            value.get("resource_id").and_then(|v| v.as_str()),
            Some("42")
        );
    }

    #[test]
    fn activity_point_identity_is_stable_and_company_distinct() {
        let a = deterministic_id("7", "11", "sale_order", "42", "actor-a");
        assert_eq!(
            a,
            deterministic_id("7", "11", "sale_order", "42", "actor-a")
        );
        assert_ne!(
            a,
            deterministic_id("7", "12", "sale_order", "42", "actor-a")
        );
        assert_ne!(
            a,
            deterministic_id("8", "11", "sale_order", "42", "actor-a")
        );
        assert_ne!(
            a,
            deterministic_id("7", "11", "sale_order", "42", "actor-b")
        );
    }

    #[test]
    fn activity_search_filter_binds_organization_and_company() {
        let filter = activity_scope_filter(7, 11);
        assert_eq!(filter.must.len(), 2);
        let values = filter
            .must
            .into_iter()
            .filter_map(|condition| match condition.condition_one_of? {
                qdrant_client::qdrant::condition::ConditionOneOf::Field(field) => {
                    match field.r#match?.match_value? {
                        MatchValue::Integer(value) => Some((field.key, value)),
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(values.contains(&("organization_id".to_string(), 7)));
        assert!(values.contains(&("company_id".to_string(), 11)));
    }

    #[test]
    fn activity_scope_rejects_other_organizations_and_companies() {
        let scopes = [(7, 11), (7, 12), (8, 11), (8, 12)];
        let accepted = scopes
            .into_iter()
            .filter(|(organization_id, company_id)| {
                scoped_activity_record_from_payload(&payload(*organization_id, *company_id), 7, 11)
                    .is_some()
            })
            .collect::<Vec<_>>();

        assert_eq!(accepted, vec![(7, 11)]);
    }

    #[test]
    fn legacy_and_raw_content_payloads_fail_closed() {
        let legacy: HashMap<String, qdrant_client::qdrant::Value> =
            Payload::try_from(serde_json::json!({
                "org_id": 7,
                "entity_type": "sale_order",
                "entity_id": "42",
                "text": "secret",
                "timestamp": 123,
                "source": "sale_order"
            }))
            .expect("legacy payload")
            .into();
        assert!(activity_record_from_payload(&legacy).is_none());

        let mut contaminated = payload(7, 11);
        contaminated.insert("text".into(), "secret".into());
        assert!(activity_record_from_payload(&contaminated).is_none());
    }
}
