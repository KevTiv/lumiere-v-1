/// RigContext — coordinator for the org-scoped AI context layer.
///
/// Wraps:
/// - `Providers` (embed, vision, parser) — swappable per config
/// - `qdrant_client::Client` — raw Qdrant client for the activities collection
///
/// All operations are scoped to `organization_id`.
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
use uuid::Uuid;

use crate::{config::Config, providers::Providers, stdb_client::StdbClient};

// ── Public types ──────────────────────────────────────────────────────────────

/// A single ERP activity to embed and store.
#[derive(Debug, Clone)]
pub struct Activity {
    pub org_id: u64,
    pub entity_type: String, // "sale_order", "project_task", …
    pub entity_id: String,
    pub text: String,
    pub timestamp: i64, // unix micros
}

/// A hit returned from context search.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ContextHit {
    pub score: f32,
    pub entity_type: String,
    pub entity_id: String,
    pub text: String,
    pub timestamp: i64,
    pub source: String,
}

/// Request to ingest a document (image or text).
pub struct IngestRequest {
    pub org_id: u64,
    pub doc_id: String,
    pub doc_type: String, // "invoice", "receipt", "delivery_note", "pdf", "text"
    pub filename: String,
    pub content: Vec<u8>,
    pub mime_type: String,
    pub uploaded_by: String,
}

/// Result of a document ingestion.
pub struct IngestResult {
    pub doc_id: String,
    pub extracted_text: String,
    pub structured_fields: serde_json::Value,
    pub chunks_embedded: usize,
    /// SpacetimeDB AiDocumentProcessingJob id (0 if not created)
    pub stdb_job_id: u64,
}

// ── RigContext ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct RigContext {
    pub providers: Providers,
    qdrant: Arc<Qdrant>,
    collection: String,
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
            collection: config.activities_collection.clone(),
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

            // Create payload indexes for fast org-scoped filtering
            for (field, ftype) in [
                ("org_id", FieldType::Integer),
                ("entity_type", FieldType::Keyword),
                ("source", FieldType::Keyword),
                ("timestamp", FieldType::Integer),
            ] {
                self.qdrant
                    .create_field_index(CreateFieldIndexCollectionBuilder::new(
                        &self.collection,
                        field,
                        ftype,
                    ))
                    .await?;
            }

            tracing::info!(collection = %self.collection, dim, "Activities collection created");
        }

        Ok(())
    }

    /// Embed and upsert a single ERP activity. Idempotent — same entity_type+entity_id+org
    /// always maps to the same point ID.
    pub async fn upsert_activity(&self, activity: &Activity) -> Result<()> {
        let vector = self.providers.embedder.embed(&activity.text).await?;
        let point_id = deterministic_id(
            &activity.org_id.to_string(),
            &activity.entity_type,
            &activity.entity_id,
            "0",
        );

        let payload = serde_json::json!({
            "org_id": activity.org_id,
            "entity_type": activity.entity_type,
            "entity_id": activity.entity_id,
            "text": activity.text,
            "timestamp": activity.timestamp,
            "source": "erp_activity",
        });

        let point = PointStruct::new(
            point_id.to_string(),
            HashMap::from([("default".to_string(), vector)]),
            Payload::try_from(payload)?,
        );

        self.qdrant
            .upsert_points(UpsertPointsBuilder::new(&self.collection, vec![point]))
            .await?;

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
                let point_id =
                    deterministic_id(&a.org_id.to_string(), &a.entity_type, &a.entity_id, "0");
                let payload = serde_json::json!({
                    "org_id": a.org_id,
                    "entity_type": a.entity_type,
                    "entity_id": a.entity_id,
                    "text": a.text,
                    "timestamp": a.timestamp,
                    "source": "erp_activity",
                });
                PointStruct::new(
                    point_id.to_string(),
                    HashMap::from([("default".to_string(), vector)]),
                    Payload::try_from(payload).unwrap_or_default(),
                )
            })
            .collect();

        let count = points.len();
        self.qdrant
            .upsert_points(UpsertPointsBuilder::new(&self.collection, points))
            .await?;

        Ok(count)
    }

    /// Semantic search scoped to a single organization.
    pub async fn search_org(
        &self,
        org_id: u64,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<ContextHit>> {
        let query_vector = self.providers.embedder.embed(query).await?;

        let filter = Filter {
            must: vec![Condition {
                condition_one_of: Some(qdrant_client::qdrant::condition::ConditionOneOf::Field(
                    FieldCondition {
                        key: "org_id".to_string(),
                        r#match: Some(Match {
                            match_value: Some(MatchValue::Integer(org_id as i64)),
                        }),
                        ..Default::default()
                    },
                )),
            }],
            ..Default::default()
        };

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
                let p = hit.payload;
                Some(ContextHit {
                    score: hit.score,
                    entity_type: p.get("entity_type")?.as_str().cloned().unwrap_or_default(),
                    entity_id: p.get("entity_id")?.as_str().cloned().unwrap_or_default(),
                    text: p.get("text")?.as_str().cloned().unwrap_or_default(),
                    timestamp: p.get("timestamp").and_then(|v| v.as_integer()).unwrap_or(0),
                    source: p.get("source")?.as_str().cloned().unwrap_or_default(),
                })
            })
            .collect();

        Ok(hits)
    }

    /// Ingest a document (image or text file) for an organization.
    /// - Images → vision provider (OCR)
    /// - Text/PDF → document parser (chunked)
    /// Each chunk is embedded and upserted. Creates a SpacetimeDB job record.
    pub async fn ingest_document(
        &self,
        req: IngestRequest,
        stdb: &StdbClient,
    ) -> Result<IngestResult> {
        let is_image = req.mime_type.starts_with("image/");

        let (extracted_text, fields, chunks) = if is_image {
            let extracted = self
                .providers
                .vision
                .extract(&req.content, &req.mime_type, &req.doc_type)
                .await?;
            let text = extracted.raw_text.clone();
            let fields = extracted.fields.clone();
            // Single chunk for images
            let chunks = vec![crate::providers::DocumentChunk {
                text: text.clone(),
                page: None,
                chunk_index: 0,
            }];
            (text, fields, chunks)
        } else {
            let chunks = self
                .providers
                .parser
                .parse(&req.content, &req.mime_type)
                .await?;
            let full_text = chunks
                .iter()
                .map(|c| c.text.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            (full_text, serde_json::json!({}), chunks)
        };

        // Embed all chunks
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = self.providers.embedder.embed_batch(&texts).await?;

        let points: Vec<PointStruct> = chunks
            .iter()
            .zip(vectors.into_iter())
            .map(|(chunk, vector)| {
                let point_id = deterministic_id(
                    &req.org_id.to_string(),
                    "document",
                    &req.doc_id,
                    &chunk.chunk_index.to_string(),
                );
                let payload = serde_json::json!({
                    "org_id": req.org_id,
                    "entity_type": "document",
                    "entity_id": req.doc_id,
                    "doc_type": req.doc_type,
                    "filename": req.filename,
                    "text": chunk.text,
                    "page": chunk.page,
                    "chunk_index": chunk.chunk_index,
                    "timestamp": chrono_now_micros(),
                    "source": "field_capture",
                    "uploaded_by": req.uploaded_by,
                });
                PointStruct::new(
                    point_id.to_string(),
                    HashMap::from([("default".to_string(), vector)]),
                    Payload::try_from(payload).unwrap_or_default(),
                )
            })
            .collect();

        let chunks_embedded = points.len();
        self.qdrant
            .upsert_points(UpsertPointsBuilder::new(&self.collection, points))
            .await?;

        // Create SpacetimeDB AiDocumentProcessingJob record
        let stdb_job_id = create_stdb_doc_job(stdb, &req, &extracted_text, chunks_embedded).await;

        Ok(IngestResult {
            doc_id: req.doc_id,
            extracted_text,
            structured_fields: fields,
            chunks_embedded,
            stdb_job_id,
        })
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deterministic UUID v5 from org + entity namespace. Ensures idempotent upserts.
fn deterministic_id(org_id: &str, entity_type: &str, entity_id: &str, chunk: &str) -> Uuid {
    let namespace = Uuid::NAMESPACE_OID;
    let key = format!("{org_id}:{entity_type}:{entity_id}:{chunk}");
    Uuid::new_v5(&namespace, key.as_bytes())
}

fn chrono_now_micros() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as i64
}

async fn create_stdb_doc_job(
    stdb: &StdbClient,
    req: &IngestRequest,
    extracted_text: &str,
    chunks: usize,
) -> u64 {
    // Call create_document_processing_job reducer
    let args = serde_json::json!([
        req.org_id,
        {
            "document_type": req.doc_type,
            "job_type": "ocr",
            "status": "Completed",
            "extracted_data": extracted_text.chars().take(2000).collect::<String>(),
            "confidence_score": 0.85_f32,
            "tokens_used": chunks as u32 * 50,
        }
    ]);

    match stdb
        .call_reducer("create_document_processing_job", args)
        .await
    {
        Ok(_) => {
            tracing::info!(doc_id = %req.doc_id, chunks, "Document processing job created in SpacetimeDB");
            0 // SpacetimeDB reducers don't return IDs; use 0 as placeholder
        }
        Err(e) => {
            tracing::warn!("Failed to create SpacetimeDB doc job: {}", e);
            0
        }
    }
}
