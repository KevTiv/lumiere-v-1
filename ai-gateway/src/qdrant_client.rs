/// Qdrant vector DB client wrapper.
/// Uses the official qdrant-client crate (gRPC).
use anyhow::{Context, Result};
use qdrant_client::{
    qdrant::{
        vectors_config::Config as VectorConfig, Condition, CreateCollectionBuilder,
        CreateFieldIndexCollectionBuilder, DeletePointsBuilder, Distance, FieldType, Filter,
        PointStruct, PointsIdsList, SearchParamsBuilder, SearchPointsBuilder, UpsertPointsBuilder,
        Value, VectorParamsBuilder, VectorsConfig,
    },
    Payload, Qdrant,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_SEARCH_LIMIT: u64 = 50;

fn bounded_search_limit(limit: u64) -> u64 {
    limit.clamp(1, MAX_SEARCH_LIMIT)
}

fn scope_conditions(organization_id: u64, company_id: u64) -> Vec<Condition> {
    vec![
        Condition::matches("organization_id", organization_id as i64),
        Condition::matches("company_id", company_id as i64),
    ]
}

#[derive(Clone)]
pub struct VectorStore {
    client: Qdrant,
    collection: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
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

#[derive(Debug, Clone)]
pub struct EmbedPoint {
    pub id: u64,
    pub vector: Vec<f32>,
    pub record: SemanticIndexRecord,
}

#[derive(Debug)]
pub struct SearchResult {
    pub score: f32,
    pub record: SemanticIndexRecord,
}

fn semantic_payload(record: &SemanticIndexRecord) -> Result<HashMap<String, Value>> {
    let payload = Payload::try_from(serde_json::to_value(record)?)
        .context("Failed to build semantic payload")?;
    Ok(payload.into())
}

fn payload_string(payload: &HashMap<String, Value>, key: &str) -> Option<String> {
    payload.get(key)?.as_str().cloned().filter(|value| !value.is_empty())
}

fn payload_u64(payload: &HashMap<String, Value>, key: &str) -> Option<u64> {
    u64::try_from(payload.get(key)?.as_integer()?).ok()
}

fn payload_strings(payload: &HashMap<String, Value>, key: &str) -> Option<Vec<String>> {
    payload
        .get(key)?
        .clone()
        .into_json()
        .as_array()?
        .iter()
        .map(|value| value.as_str().map(str::to_string))
        .collect()
}

fn semantic_record_from_payload(payload: &HashMap<String, Value>) -> Option<SemanticIndexRecord> {
    if ["text", "text_snippet", "content", "filename", "source"]
        .iter()
        .any(|key| payload.contains_key(*key))
    {
        return None;
    }

    Some(SemanticIndexRecord {
        organization_id: payload_u64(payload, "organization_id")?,
        company_id: payload_u64(payload, "company_id")?,
        resource_kind: payload_string(payload, "resource_kind")?,
        resource_id: payload_string(payload, "resource_id")?,
        resource_version: payload_string(payload, "resource_version")?,
        source_fingerprint: payload_string(payload, "source_fingerprint")?,
        embedding_model: payload_string(payload, "embedding_model")?,
        indexed_at: payload_string(payload, "indexed_at")?,
        tags: payload_strings(payload, "tags")?,
    })
}

fn scoped_semantic_record_from_payload(
    payload: &HashMap<String, Value>,
    organization_id: u64,
    company_id: u64,
) -> Option<SemanticIndexRecord> {
    let record = semantic_record_from_payload(payload)?;
    (record.organization_id == organization_id && record.company_id == company_id)
        .then_some(record)
}

impl VectorStore {
    pub async fn new(url: &str, api_key: Option<&str>, collection: String) -> Result<Self> {
        let mut builder = Qdrant::from_url(url);
        if let Some(key) = api_key {
            builder = builder.api_key(key);
        }
        let client = builder.build().context("Failed to connect to Qdrant")?;
        Ok(VectorStore { client, collection })
    }

    /// Verify Qdrant is reachable and the configured semantic collection exists.
    /// This is a read-only readiness probe; it never creates or mutates a collection.
    pub async fn check_ready(&self) -> Result<()> {
        let collections = self
            .client
            .list_collections()
            .await
            .context("list Qdrant collections")?;
        if !collections
            .collections
            .iter()
            .any(|collection| collection.name == self.collection)
        {
            anyhow::bail!("configured Qdrant collection is unavailable");
        }
        Ok(())
    }

    /// Create the collection if it does not already exist.
    pub async fn ensure_collection(&self, dim: u64) -> Result<()> {
        let collections = self
            .client
            .list_collections()
            .await
            .context("Failed to list Qdrant collections")?;

        let exists = collections
            .collections
            .iter()
            .any(|c| c.name == self.collection);

        if !exists {
            self.client
                .create_collection(
                    CreateCollectionBuilder::new(self.collection.clone())
                        .vectors_config(VectorsConfig {
                            config: Some(VectorConfig::Params(
                                VectorParamsBuilder::new(dim, Distance::Cosine).build(),
                            )),
                        })
                        .build(),
                )
                .await
                .context("Failed to create Qdrant collection")?;

            // Create payload indexes for fast tenant-filtered queries.
            self.client
                .create_field_index(CreateFieldIndexCollectionBuilder::new(
                    self.collection.clone(),
                    "company_id",
                    FieldType::Integer,
                ))
                .await
                .context("Failed to create company_id index")?;

            self.client
                .create_field_index(CreateFieldIndexCollectionBuilder::new(
                    self.collection.clone(),
                    "resource_kind",
                    FieldType::Keyword,
                ))
                .await
                .context("Failed to create resource_kind index")?;

            tracing::info!(
                "Qdrant collection '{}' created (dim={})",
                self.collection,
                dim
            );
        }

        // Reconcile the mandatory organization index even when an operator
        // explicitly points at an existing collection. Legacy points without
        // organization_id remain fail-closed until they are reindexed.
        self.client
            .create_field_index(CreateFieldIndexCollectionBuilder::new(
                self.collection.clone(),
                "organization_id",
                FieldType::Integer,
            ))
            .await
            .context("Failed to create organization_id index")?;

        Ok(())
    }

    /// Upsert a vector point into the collection.
    pub async fn upsert(&self, point: EmbedPoint) -> Result<()> {
        let payload = semantic_payload(&point.record)?;

        self.client
            .upsert_points(
                UpsertPointsBuilder::new(
                    self.collection.clone(),
                    vec![PointStruct::new(point.id, point.vector, payload)],
                )
                .wait(true)
                .build(),
            )
            .await
            .context("Qdrant upsert failed")?;

        Ok(())
    }

    /// Delete a point by its STDB embedding ID.
    pub async fn delete(&self, embedding_id: u64) -> Result<()> {
        self.client
            .delete_points(
                DeletePointsBuilder::new(self.collection.clone())
                    .points(PointsIdsList {
                        ids: vec![embedding_id.into()],
                    })
                    .wait(true),
            )
            .await
            .context("Qdrant delete failed")?;

        Ok(())
    }

    /// ANN search with mandatory organization and company filters.
    pub async fn search(
        &self,
        query_vector: Vec<f32>,
        organization_id: u64,
        company_id: u64,
        content_type: Option<&str>,
        limit: u64,
        score_threshold: Option<f32>,
    ) -> Result<Vec<SearchResult>> {
        let content_types = content_type.map(|ct| vec![ct.to_string()]);
        self.search_content_types(
            query_vector,
            organization_id,
            company_id,
            content_types.as_deref(),
            limit,
            score_threshold,
        )
        .await
    }

    /// ANN search with mandatory organization/company and optional content-type filters.
    pub async fn search_content_types(
        &self,
        query_vector: Vec<f32>,
        organization_id: u64,
        company_id: u64,
        content_types: Option<&[String]>,
        limit: u64,
        score_threshold: Option<f32>,
    ) -> Result<Vec<SearchResult>> {
        let mut conditions = scope_conditions(organization_id, company_id);

        let content_types = content_types
            .unwrap_or(&[])
            .iter()
            .filter_map(|ct| {
                let trimmed = ct.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            })
            .collect::<Vec<_>>();

        if !content_types.is_empty() {
            conditions.push(Condition::matches("resource_kind", content_types));
        }

        let mut builder = SearchPointsBuilder::new(
            self.collection.clone(),
            query_vector,
            bounded_search_limit(limit),
        )
            .filter(Filter {
                must: conditions,
                ..Default::default()
            })
            .with_payload(true)
            .params(SearchParamsBuilder::default().exact(false).build());

        if let Some(threshold) = score_threshold {
            builder = builder.score_threshold(threshold);
        }

        let response = self
            .client
            .search_points(builder.build())
            .await
            .context("Qdrant search failed")?;

        let results = response
            .result
            .into_iter()
            .filter_map(|p| {
                let payload = p.payload;
                let score = p.score;

                let record = scoped_semantic_record_from_payload(
                    &payload,
                    organization_id,
                    company_id,
                )?;
                Some(SearchResult { score, record })
            })
            .collect();

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(organization_id: u64, company_id: u64) -> HashMap<String, Value> {
        Payload::try_from(serde_json::json!({
            "organization_id": organization_id,
            "company_id": company_id,
            "resource_kind": "sale_order",
            "resource_id": "11",
            "resource_version": "hash",
            "source_fingerprint": "hash",
            "embedding_model": "test",
            "indexed_at": "2026-08-25T00:00:00Z",
            "tags": ["sales"]
        }))
        .expect("payload")
        .into()
    }

    #[test]
    fn search_limit_is_bounded() {
        assert_eq!(bounded_search_limit(0), 1);
        assert_eq!(bounded_search_limit(20), 20);
        assert_eq!(bounded_search_limit(500), MAX_SEARCH_LIMIT);
    }

    #[test]
    fn scope_filter_contains_organization_and_company() {
        let conditions = scope_conditions(42, 7);
        let rendered = format!("{conditions:?}");

        assert_eq!(conditions.len(), 2);
        assert!(rendered.contains("organization_id"));
        assert!(rendered.contains("company_id"));
        assert!(rendered.contains("42"));
        assert!(rendered.contains('7'));
    }

    #[test]
    fn semantic_payload_is_reference_only() {
        let record = SemanticIndexRecord {
            organization_id: 42,
            company_id: 7,
            resource_kind: "sale_order".into(),
            resource_id: "11".into(),
            resource_version: "hash".into(),
            source_fingerprint: "hash".into(),
            embedding_model: "test".into(),
            indexed_at: "2026-08-25T00:00:00Z".into(),
            tags: vec!["sales".into()],
        };
        let payload = semantic_payload(&record).unwrap();
        assert!(payload.contains_key("resource_kind"));
        assert!(!payload.contains_key("text"));
        assert!(!payload.contains_key("text_snippet"));
        assert_eq!(semantic_record_from_payload(&payload), Some(record));
    }

    #[test]
    fn semantic_payload_rejects_negative_scope_ids() {
        let payload: HashMap<String, Value> = Payload::try_from(serde_json::json!({
            "organization_id": -1,
            "company_id": 7,
            "resource_kind": "sale_order",
            "resource_id": "11",
            "resource_version": "hash",
            "source_fingerprint": "hash",
            "embedding_model": "test",
            "indexed_at": "2026-08-25T00:00:00Z",
            "tags": []
        }))
        .unwrap()
        .into();

        assert!(semantic_record_from_payload(&payload).is_none());
    }

    #[test]
    fn semantic_scope_rejects_other_organizations_and_companies() {
        let scopes = [(42, 7), (42, 8), (43, 7), (43, 8)];
        let accepted = scopes
            .into_iter()
            .filter(|(organization_id, company_id)| {
                scoped_semantic_record_from_payload(
                    &payload(*organization_id, *company_id),
                    42,
                    7,
                )
                .is_some()
            })
            .collect::<Vec<_>>();

        assert_eq!(accepted, vec![(42, 7)]);
    }

    #[test]
    fn semantic_payload_with_raw_content_fails_closed() {
        let mut contaminated = payload(42, 7);
        contaminated.insert("text_snippet".into(), "secret".into());
        assert!(semantic_record_from_payload(&contaminated).is_none());
    }

    #[tokio::test]
    #[ignore = "requires QDRANT_TEST_URL"]
    async fn qdrant_enforces_two_organization_company_isolation() {
        let url = std::env::var("QDRANT_TEST_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:6334".into());
        let collection = format!("lumiere_q0_isolation_{}", uuid::Uuid::new_v4().simple());
        let store = VectorStore::new(&url, None, collection.clone())
            .await
            .expect("test vector store");
        store.ensure_collection(3).await.expect("test collection");

        for (id, organization_id, company_id) in [
            (1, 42, 7),
            (2, 42, 8),
            (3, 43, 7),
            (4, 43, 8),
        ] {
            store
                .upsert(EmbedPoint {
                    id,
                    vector: vec![1.0, 0.0, 0.0],
                    record: SemanticIndexRecord {
                        organization_id,
                        company_id,
                        resource_kind: "sale_order".into(),
                        resource_id: id.to_string(),
                        resource_version: "1".into(),
                        source_fingerprint: format!("sha256:{id}"),
                        embedding_model: "integration-test".into(),
                        indexed_at: "2026-08-25T00:00:00Z".into(),
                        tags: vec!["test".into()],
                    },
                })
                .await
                .expect("scoped point");
        }

        let contaminated: HashMap<String, Value> = Payload::try_from(serde_json::json!({
            "organization_id": 42,
            "company_id": 7,
            "resource_kind": "sale_order",
            "resource_id": "99",
            "resource_version": "1",
            "source_fingerprint": "sha256:legacy",
            "embedding_model": "integration-test",
            "indexed_at": "2026-08-25T00:00:00Z",
            "tags": ["test"],
            "text": "must not be returned"
        }))
        .expect("contaminated payload")
        .into();
        store
            .client
            .upsert_points(
                UpsertPointsBuilder::new(
                    collection.clone(),
                    vec![PointStruct::new(
                        99,
                        vec![1.0, 0.0, 0.0],
                        contaminated,
                    )],
                )
                .wait(true),
            )
            .await
            .expect("contaminated point");

        for (organization_id, company_id, expected_resource_id) in [
            (42, 7, "1"),
            (42, 8, "2"),
            (43, 7, "3"),
            (43, 8, "4"),
        ] {
            let hits = store
                .search(
                    vec![1.0, 0.0, 0.0],
                    organization_id,
                    company_id,
                    None,
                    10,
                    None,
                )
                .await
                .expect("scoped search");
            assert_eq!(hits.len(), 1);
            assert_eq!(hits[0].record.organization_id, organization_id);
            assert_eq!(hits[0].record.company_id, company_id);
            assert_eq!(hits[0].record.resource_id, expected_resource_id);
        }

        store
            .client
            .delete_collection(collection)
            .await
            .expect("delete test collection");
    }
}
