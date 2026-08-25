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
    Qdrant,
};
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

#[derive(Debug, Clone)]
pub struct EmbedPoint {
    /// Maps to SearchEmbedding.id from SpacetimeDB
    pub id: u64,
    pub vector: Vec<f32>,
    pub organization_id: u64,
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub text_snippet: String,
}

#[derive(Debug)]
pub struct SearchResult {
    pub score: f32,
    pub company_id: u64,
    pub content_type: String,
    pub content_id: u64,
    pub stdb_embedding_id: u64,
    pub text_snippet: String,
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
            // The collection is versioned when this schema changes so every
            // point is guaranteed to carry both scope keys.
            self.client
                .create_field_index(CreateFieldIndexCollectionBuilder::new(
                    self.collection.clone(),
                    "organization_id",
                    FieldType::Integer,
                ))
                .await
                .context("Failed to create organization_id index")?;

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
                    "content_type",
                    FieldType::Keyword,
                ))
                .await
                .context("Failed to create content_type index")?;

            tracing::info!(
                "Qdrant collection '{}' created (dim={})",
                self.collection,
                dim
            );
        }

        Ok(())
    }

    /// Upsert a vector point into the collection.
    pub async fn upsert(&self, point: EmbedPoint) -> Result<()> {
        let payload: HashMap<String, Value> = [
            (
                "organization_id".to_string(),
                Value::from(point.organization_id as i64),
            ),
            (
                "company_id".to_string(),
                Value::from(point.company_id as i64),
            ),
            ("content_type".to_string(), Value::from(point.content_type)),
            (
                "content_id".to_string(),
                Value::from(point.content_id as i64),
            ),
            (
                "stdb_embedding_id".to_string(),
                Value::from(point.id as i64),
            ),
            ("text_snippet".to_string(), Value::from(point.text_snippet)),
        ]
        .into();

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
            conditions.push(Condition::matches("content_type", content_types));
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

                let company_id = payload.get("company_id")?.as_integer()? as u64;
                let content_type = payload.get("content_type")?.as_str()?.to_string();
                let content_id = payload.get("content_id")?.as_integer()? as u64;
                let stdb_embedding_id = payload.get("stdb_embedding_id")?.as_integer()? as u64;
                let text_snippet = payload
                    .get("text_snippet")
                    .and_then(|v| v.as_str())
                    .cloned()
                    .unwrap_or_default();

                Some(SearchResult {
                    score,
                    company_id,
                    content_type,
                    content_id,
                    stdb_embedding_id,
                    text_snippet,
                })
            })
            .collect();

        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
