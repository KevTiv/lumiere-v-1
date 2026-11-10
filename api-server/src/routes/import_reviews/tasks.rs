//! Chat uploads prepare durable source review; only the existing import routes
//! may create business records after the operator reviews the result.
use super::{model::Dataset, scope, StorageScope};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Semaphore,
};

use crate::{cold_tier::pg_pool, error::ApiError, state::AppState, web_session::OrgSession};

mod managed_source;
mod manifest;
#[cfg(test)]
mod tests;
use manifest::validate_preparation_manifest;

const MAX_FILE_BYTES: usize = 5_000_000;
const MAX_TOTAL_BYTES: usize = 20_000_000;
const MAX_OUTPUT_BYTES: u64 = 8_000_000;
static PREPARATION_SLOTS: Semaphore = Semaphore::const_new(2);

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SourceFile {
    file_name: String,
    content_base64: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Submission {
    company_id: u64,
    request_id: String,
    conversation_key: String,
    files: Vec<SourceFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    preparation: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TaskQuery {
    company_id: u64,
    conversation_key: Option<String>,
    decision_id: Option<String>,
    cursor: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ProcessingMode {
    PrepareImport,
    InspectOnly,
}

impl ProcessingMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::PrepareImport => "prepare_import",
            Self::InspectOnly => "inspect_only",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "prepare_import" => Some(Self::PrepareImport),
            "inspect_only" => Some(Self::InspectOnly),
            _ => None,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DecisionBody {
    company_id: u64,
    decision_id: String,
    expected_revision: i32,
    option_id: String,
    other_text: Option<String>,
}

struct Original {
    file_name: String,
    bytes: Vec<u8>,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Preparation {
    datasets: Vec<Dataset>,
    #[serde(default)]
    warnings: Vec<String>,
    #[serde(default)]
    coverage: Option<Value>,
    #[serde(default, rename = "preparationReceipt")]
    preparation_receipt: Option<Value>,
}

fn valid_request_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn decode_submission(body: &Submission) -> Result<(Vec<Original>, String), ApiError> {
    if body.company_id == 0
        || !valid_request_id(&body.request_id)
        || body.conversation_key.is_empty()
        || body.conversation_key.len() > 200
        || body.conversation_key.chars().any(char::is_control)
        || body.files.is_empty()
        || body.files.len() > 20
    {
        return Err(ApiError::BadRequest(
            "invalid import task identity or file count".into(),
        ));
    }
    if let Some(options) = &body.preparation {
        if options.get("version").and_then(Value::as_u64) != Some(1)
            || serde_json::to_vec(options)
                .map_err(ApiError::internal)?
                .len()
                > 200_000
        {
            return Err(ApiError::BadRequest(
                "invalid or oversized import preparation options".into(),
            ));
        }
    }
    let mut total = 0usize;
    let mut originals = Vec::with_capacity(body.files.len());
    for source in &body.files {
        let name = &source.file_name;
        let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if name.is_empty()
            || name.len() > 255
            || name.contains(['/', '\\'])
            || name.chars().any(char::is_control)
            || !matches!(extension.as_str(), "csv" | "xlsx")
            || source.content_base64.len() > 6_666_668
        {
            return Err(ApiError::BadRequest(
                "import files must be CSV or XLSX with a valid filename, at most 5 MB each".into(),
            ));
        }
        let bytes = STANDARD
            .decode(&source.content_base64)
            .map_err(|_| ApiError::BadRequest("invalid import file encoding".into()))?;
        total = total.saturating_add(bytes.len());
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES {
            return Err(ApiError::BadRequest(
                "import files must contain data, at most 5 MB each and 20 MB combined".into(),
            ));
        }
        originals.push(Original {
            file_name: name.clone(),
            sha256: hex::encode(Sha256::digest(&bytes)),
            bytes,
        });
    }
    // Hash decoded bytes, not interchangeable base64 spellings, and bind all
    // scope and file ordering fields to the immutable request identity.
    let mut identity = json!({"companyId":body.company_id.to_string(),"conversationKey":body.conversation_key,
        "files":originals.iter().map(|s|json!({"fileName":s.file_name,"sha256":s.sha256,"size":s.bytes.len()})).collect::<Vec<_>>()});
    // Preserve old request hashes when no options were selected.
    if let Some(options) = &body.preparation {
        identity["preparation"] = options.clone();
    }
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&identity).map_err(ApiError::internal)?,
    ));
    Ok((originals, hash))
}

async fn accept(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    body: &Submission,
    originals: &[Original],
    hash: &str,
) -> Result<(), ApiError> {
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let decision = decision_request(&body.request_id, 1, false, &Value::Null);
    let inserted = tx.query_opt("INSERT INTO lumiere_platform.import_task (organization_id,company_id,actor_identity,request_id,conversation_key,request_sha256,decision_request,preparation_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING request_id", &[&org,&company,&scope.actor,&body.request_id,&body.conversation_key,&hash,&decision,&body.preparation]).await.map_err(ApiError::internal)?;
    if inserted.is_some() {
        for (ordinal, source) in originals.iter().enumerate() {
            let ordinal = ordinal as i32;
            tx.execute("INSERT INTO lumiere_platform.import_task_source (organization_id,company_id,actor_identity,request_id,ordinal,file_name,source_sha256,original_bytes) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8)", &[&org,&company,&scope.actor,&body.request_id,&ordinal,&source.file_name,&source.sha256,&source.bytes]).await.map_err(ApiError::internal)?;
        }
    } else {
        let existing = tx.query_one("SELECT request_sha256,company_id::text FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND actor_identity=$2 AND request_id=$3", &[&org,&scope.actor,&body.request_id]).await.map_err(ApiError::internal)?;
        if existing.get::<_, String>("request_sha256") != hash
            || existing.get::<_, String>("company_id") != company
        {
            return Err(ApiError::Conflict("this import request identity belongs to different source bytes or company settings".into()));
        }
    }
    tx.commit().await.map_err(ApiError::internal)
}

fn validate_decision(body: &DecisionBody, company: u64) -> Result<(), ApiError> {
    if body.company_id != company
        || !valid_request_id(&body.decision_id)
        || body.expected_revision < 1
        || body.expected_revision == i32::MAX
        || !matches!(
            body.option_id.as_str(),
            "prepare_import" | "inspect_only" | "other"
        )
    {
        return Err(ApiError::BadRequest(
            "invalid file decision identity, revision or option".into(),
        ));
    }
    if body.option_id == "other" {
        if !body.other_text.as_deref().is_some_and(|text| {
            !text.trim().is_empty()
                && text.len() <= 8000
                && text.chars().count() <= 2000
                && !text
                    .chars()
                    .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
        }) {
            return Err(ApiError::BadRequest(
                "describe what you want to do with these files".into(),
            ));
        }
    } else if body.other_text.is_some() {
        return Err(ApiError::BadRequest(
            "custom text is only accepted with Other; notes are never executed automatically"
                .into(),
        ));
    }
    Ok(())
}

fn decision_receipt(row: &tokio_postgres::Row) -> Value {
    json!({"decisionId":row.get::<_,String>("decision_id"),"optionId":row.get::<_,String>("option_id"),"otherText":row.get::<_,Option<String>>("other_text"),"revision":row.get::<_,i32>("revision"),"createdAt":row.get::<_,String>("created_at")})
}

fn decision_request(request: &str, revision: i32, approved: bool, latest: &Value) -> Value {
    let question = if approved {
        "Your chosen action is approved. Custom notes are retained in the decision history and are not executed automatically."
    } else if latest.is_null() {
        "What would you like Lumière to do with these files? Their originals are saved; file contents have not been analyzed."
    } else {
        "Your instructions are saved and work is paused. Choose a supported action below; your custom note will not be applied or executed automatically."
    };
    json!({"id":format!("{request}:purpose"),"revision":revision,"status":if approved{"approved"}else{"pending"},"question":question,"allowOther":true,"options":[{"id":"prepare_import","label":"Prepare an import for review"},{"id":"inspect_only","label":"Inspect files only"}],"selectedOptionId":latest.get("optionId").cloned().unwrap_or(Value::Null),"otherText":latest.get("otherText").cloned().unwrap_or(Value::Null),"decisionId":latest.get("decisionId").cloned().unwrap_or(Value::Null)})
}

fn decision_payload_hash(
    request: &str,
    source_hash: &str,
    question: &Value,
    body: &DecisionBody,
) -> Result<String, ApiError> {
    let payload =
        json!({"requestId":request,"sourceSha256":source_hash,"question":question,"decision":body});
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(&payload).map_err(ApiError::internal)?,
    )))
}

async fn save_decision(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    request: &str,
    body: &DecisionBody,
) -> Result<Value, ApiError> {
    validate_decision(body, scope.company)?;
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let task=tx.query_opt("SELECT state,decision_revision,request_sha256,decision_request FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 FOR UPDATE",&[&org,&company,&scope.actor,&request]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::NotFound("import task not found".into()))?;
    let source_hash: String = task.get("request_sha256");
    if let Some(replay)=tx.query_opt("SELECT request_id,company_id::text,payload_sha256,question_json,decision_id,option_id,other_text,revision,created_at::text FROM lumiere_platform.import_task_decision WHERE organization_id=$1::text::numeric AND actor_identity=$2 AND decision_id=$3",&[&org,&scope.actor,&body.decision_id]).await.map_err(ApiError::internal)? {
        let payload_hash=decision_payload_hash(request,&source_hash,&replay.get::<_,Value>("question_json"),body)?;
        if replay.get::<_,String>("request_id")!=request || replay.get::<_,String>("company_id")!=company || replay.get::<_,String>("payload_sha256")!=payload_hash {
            return Err(ApiError::Conflict("this decision identity belongs to a different task, revision or answer".into()));
        }
        let receipt=decision_receipt(&replay);
        tx.commit().await.map_err(ApiError::internal)?;
        return Ok(receipt);
    }
    if task.get::<_, String>("state") != "awaiting_decision"
        || task.get::<_, i32>("decision_revision") != body.expected_revision
    {
        return Err(ApiError::Conflict(
            "the file decision changed; refresh its current question before answering".into(),
        ));
    }
    let revision = body.expected_revision + 1;
    let question: Value = task.get("decision_request");
    let payload_hash = decision_payload_hash(request, &source_hash, &question, body)?;
    let row=tx.query_opt("INSERT INTO lumiere_platform.import_task_decision (organization_id,company_id,actor_identity,request_id,decision_id,revision,request_sha256,payload_sha256,option_id,other_text,question_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING decision_id,option_id,other_text,revision,created_at::text",&[&org,&company,&scope.actor,&request,&body.decision_id,&revision,&source_hash,&payload_hash,&body.option_id,&body.other_text,&question]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::Conflict("this decision identity was already used for a different task or answer".into()))?;
    let mode = ProcessingMode::from_str(&body.option_id).map(ProcessingMode::as_str);
    let state = if mode.is_some() {
        "saved"
    } else {
        "awaiting_decision"
    };
    let receipt = decision_receipt(&row);
    let next_question = decision_request(request, revision, mode.is_some(), &receipt);
    tx.execute("UPDATE lumiere_platform.import_task SET state=$5,decision_revision=$6,approved_mode=$7,decision_request=$8 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4",&[&org,&company,&scope.actor,&request,&state,&revision,&mode,&next_question]).await.map_err(ApiError::internal)?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(receipt)
}

async fn read_decision(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    request: &str,
    decision: &str,
) -> Result<Value, ApiError> {
    if !valid_request_id(decision) {
        return Err(ApiError::BadRequest("invalid decision identity".into()));
    }
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row=client.query_opt("SELECT decision_id,option_id,other_text,revision,created_at::text FROM lumiere_platform.import_task_decision WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND decision_id=$5",&[&scope.organization.to_string(),&scope.company.to_string(),&scope.actor,&request,&decision]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::NotFound("file decision receipt not found".into()))?;
    Ok(decision_receipt(&row))
}

async fn run_preparation(body: &Submission, mode: ProcessingMode) -> Result<Preparation, ApiError> {
    let script = std::env::var("LUMIERE_IMPORT_PREPARE_SCRIPT").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../scripts/import-task-prepare.py"
            )
            .into()
        } else {
            "/app/scripts/import-task-prepare.py".into()
        }
    });
    run_preparation_script(body, &script, mode).await
}

async fn run_preparation_script(
    body: &Submission,
    script: &str,
    mode: ProcessingMode,
) -> Result<Preparation, ApiError> {
    // Backpressure is explicit. Accepted bytes remain saved and a retry resumes
    // the same task if the bounded worker queue is currently occupied.
    let _permit = PREPARATION_SLOTS.try_acquire().map_err(|_| {
        ApiError::Unavailable(
            "Import preparation is busy. The files are saved; retry the same submission.".into(),
        )
    })?;
    let mut input = json!({"files":body.files,"mode":mode});
    if let Some(options) = &body.preparation {
        input["preparation"] = options.clone();
    }
    let input = serde_json::to_vec(&input).map_err(ApiError::internal)?;
    let mut child = tokio::process::Command::new("python3")
        .arg("-B")
        .arg("-I")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| {
            ApiError::Unavailable(
                "Import preparation worker is unavailable. Files are saved; retry this submission."
                    .into(),
            )
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ApiError::Internal("missing preparation input".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::Internal("missing preparation output".into()))?;
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        let write = async move {
            stdin.write_all(&input).await?;
            stdin.shutdown().await?;
            // A pipe's shutdown does not necessarily close its descriptor.
            // The bounded worker reads through EOF before parsing the input.
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let read = async {
            let mut output = Vec::new();
            stdout
                .take(MAX_OUTPUT_BYTES + 1)
                .read_to_end(&mut output)
                .await?;
            Ok::<_, std::io::Error>(output)
        };
        let (_, output) = tokio::try_join!(write, read)?;
        let status = child.wait().await?;
        Ok::<_, std::io::Error>((status, output))
    })
    .await
    .map_err(|_| {
        ApiError::Unavailable(
            "Import preparation timed out. Files are saved; retry this submission.".into(),
        )
    })?
    .map_err(|_| {
        ApiError::Unavailable(
            "Import preparation was interrupted. Files are saved; retry this submission.".into(),
        )
    })?;
    if result.1.len() as u64 > MAX_OUTPUT_BYTES {
        return Err(ApiError::BadRequest(
            "prepared review exceeds the supported size; split this import into smaller groups"
                .into(),
        ));
    }
    if !result.0.success() {
        // Worker errors are bounded structured messages, never stderr or raw data.
        let error = serde_json::from_slice::<Value>(&result.1)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_owned))
            .filter(|s| !s.is_empty() && s.len() <= 1000 && !s.chars().any(char::is_control));
        return Err(match error {
            Some(error) => ApiError::BadRequest(error),
            None => ApiError::Unavailable(
                "Import preparation worker failed. Files are saved; retry this submission.".into(),
            ),
        });
    }
    serde_json::from_slice(&result.1)
        .map_err(|_| ApiError::Internal("invalid import preparation output".into()))
}

fn validate_preparation(
    prepared: &Preparation,
    originals: &[Original],
    mode: ProcessingMode,
) -> Result<(), ApiError> {
    validate_preparation_manifest(prepared, originals)?;
    let held_only = prepared.coverage.as_ref().is_some_and(|coverage| {
        coverage["complete"] == false
            && coverage["files"].as_array().is_some_and(|files| {
                !files.is_empty() && files.iter().all(|file| file["status"] == "held")
            })
    });
    if (prepared.datasets.is_empty() && !held_only)
        || prepared.datasets.len() > 100
        || prepared.warnings.len() > 100
        || prepared.warnings.iter().any(|s| s.len() > 1000)
    {
        return Err(ApiError::BadRequest("invalid prepared review size".into()));
    }
    for dataset in &prepared.datasets {
        if mode == ProcessingMode::InspectOnly && dataset.target_entity != "source_observation" {
            return Err(ApiError::BadRequest(
                "inspection cannot prepare business record imports".into(),
            ));
        }
        super::model::validate_dataset(dataset).map_err(ApiError::BadRequest)?;
        if serde_json::to_vec(dataset)
            .map_err(ApiError::internal)?
            .len()
            > 4_000_000
        {
            return Err(ApiError::BadRequest(
                "a prepared review exceeds the supported size".into(),
            ));
        }
        for item in &dataset.items {
            if !originals.iter().any(|source| {
                source.file_name == item.source.file && source.sha256 == item.source.sha256
            }) {
                return Err(ApiError::BadRequest(
                    "prepared source does not match the saved original file".into(),
                ));
            }
        }
    }
    Ok(())
}

async fn finish(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    request: &str,
    prepared: &Preparation,
    mode: ProcessingMode,
) -> Result<(), ApiError> {
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let task = tx.query_one("SELECT state,approved_mode FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 FOR UPDATE", &[&org,&company,&scope.actor,&request]).await.map_err(ApiError::internal)?;
    if task.get::<_, Option<String>>("approved_mode").as_deref() != Some(mode.as_str()) {
        return Err(ApiError::Conflict(
            "file processing requires an explicit decision for this mode".into(),
        ));
    }
    if task.get::<_, String>("state") == "saved" {
        for dataset in &prepared.datasets {
            // Same-task retries reuse the immutable review; a new preparation
            // gets fresh confirmations even when its source bytes and rules
            // are identical. Prior business effects remain guarded separately.
            let hash = hex::encode(Sha256::digest(
                serde_json::to_vec(
                    &json!({"version":1,"actor":scope.actor,"requestId":request,"dataset":dataset}),
                )
                .map_err(ApiError::internal)?,
            ));
            let inserted = tx.query_opt("INSERT INTO lumiere_platform.import_review_batch (organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,company_id,source_sha256) DO NOTHING RETURNING id", &[&org,&company,&dataset.title,&dataset.target_entity,&dataset.source_file,&hash,&scope.actor]).await.map_err(ApiError::internal)?;
            let batch: i64 = if let Some(row) = inserted {
                let batch = row.get("id");
                for item in &dataset.items {
                    let source = serde_json::to_value(item).map_err(ApiError::internal)?;
                    let proposed =
                        serde_json::to_value(&item.proposed).map_err(ApiError::internal)?;
                    tx.execute("INSERT INTO lumiere_platform.import_review_item (organization_id,company_id,batch_id,source_key,source_json,proposed_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6)", &[&org,&company,&batch,&item.key,&source,&proposed]).await.map_err(ApiError::internal)?;
                }
                batch
            } else {
                tx.query_one("SELECT id FROM lumiere_platform.import_review_batch WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND source_sha256=$3", &[&org,&company,&hash]).await.map_err(ApiError::internal)?.get("id")
            };
            tx.execute("INSERT INTO lumiere_platform.import_task_review (organization_id,company_id,actor_identity,request_id,batch_id) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5) ON CONFLICT DO NOTHING", &[&org,&company,&scope.actor,&request,&batch]).await.map_err(ApiError::internal)?;
        }
        let warnings = json!(prepared.warnings);
        let ready = if mode == ProcessingMode::InspectOnly {
            "inspection_ready"
        } else {
            "needs_review"
        };
        tx.execute("UPDATE lumiere_platform.import_task SET state=$6,warnings=$5,coverage_json=$7,preparation_receipt_json=$8 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4", &[&org,&company,&scope.actor,&request,&warnings,&ready,&prepared.coverage,&prepared.preparation_receipt]).await.map_err(ApiError::internal)?;
    }
    tx.commit().await.map_err(ApiError::internal)
}

pub(super) async fn read_task(
    pool: &deadpool_postgres::Pool,
    scope: StorageScope<'_>,
    request: &str,
) -> Result<Value, ApiError> {
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    // Status, source receipts and review counts must describe the same commit,
    // even while another request completes preparation or reviews rows.
    let tx = client
        .build_transaction()
        .isolation_level(tokio_postgres::IsolationLevel::RepeatableRead)
        .read_only(true)
        .start()
        .await
        .map_err(ApiError::internal)?;
    let org = scope.organization.to_string();
    let company = scope.company.to_string();
    let task = tx.query_opt("SELECT request_id,company_id::text,conversation_key,state,warnings,error,created_at::text,decision_request,preparation_json,coverage_json,preparation_receipt_json FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4", &[&org,&company,&scope.actor,&request]).await.map_err(ApiError::internal)?
        .ok_or_else(||ApiError::NotFound("import task not found".into()))?;
    let sources = tx
        .query(
            "SELECT source.ordinal,source.file_name,source.source_sha256,
                    octet_length(source.original_bytes) AS size,
                    previous.request_id AS previous_request_id,
                    previous.ordinal AS previous_ordinal,
                    previous.file_name AS previous_file_name,
                    previous.source_sha256 AS previous_sha256
             FROM lumiere_platform.import_task_source source
             JOIN lumiere_platform.import_task current_task USING
                 (organization_id,company_id,actor_identity,request_id)
             LEFT JOIN LATERAL (
                 SELECT prior.request_id,prior.ordinal,prior.file_name,prior.source_sha256
                 FROM lumiere_platform.import_task_source prior
                 JOIN lumiere_platform.import_task prior_task USING
                     (organization_id,company_id,actor_identity,request_id)
                 WHERE prior.organization_id=source.organization_id
                   AND prior.company_id=source.company_id
                   AND prior.actor_identity=source.actor_identity
                   AND (prior_task.created_at,prior.request_id) <
                       (current_task.created_at,current_task.request_id)
                   AND prior_task.state IN ('needs_review','inspection_ready')
                   AND (prior.source_sha256=source.source_sha256 OR prior.file_name=source.file_name)
                 ORDER BY (prior.source_sha256=source.source_sha256) DESC,
                          prior_task.created_at DESC,prior.request_id DESC,prior.ordinal
                 LIMIT 1
             ) previous ON true
             WHERE source.organization_id=$1::text::numeric AND source.company_id=$2::text::numeric
               AND source.actor_identity=$3 AND source.request_id=$4
             ORDER BY source.ordinal",
            &[&org, &company, &scope.actor, &request],
        )
        .await
        .map_err(ApiError::internal)?;
    let reviews = tx.query("SELECT batch.id::text,batch.title,batch.target_entity,count(item.id)::int AS total,count(item.id) FILTER (WHERE item.state='needs_review')::int AS pending,count(item.id) FILTER (WHERE item.state='confirmed')::int AS confirmed,count(item.id) FILTER (WHERE item.state='excluded')::int AS excluded FROM lumiere_platform.import_task_review link JOIN lumiere_platform.import_review_batch batch ON batch.organization_id=link.organization_id AND batch.company_id=link.company_id AND batch.id=link.batch_id LEFT JOIN lumiere_platform.import_review_item item ON item.organization_id=batch.organization_id AND item.company_id=batch.company_id AND item.batch_id=batch.id WHERE link.organization_id=$1::text::numeric AND link.company_id=$2::text::numeric AND link.actor_identity=$3 AND link.request_id=$4 GROUP BY batch.id ORDER BY batch.id", &[&org,&company,&scope.actor,&request]).await.map_err(ApiError::internal)?;
    let decisions=tx.query("SELECT decision_id,option_id,other_text,revision,created_at::text FROM lumiere_platform.import_task_decision WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 ORDER BY revision DESC LIMIT 100",&[&org,&company,&scope.actor,&request]).await.map_err(ApiError::internal)?;
    tx.commit().await.map_err(ApiError::internal)?;
    let history = decisions.iter().map(decision_receipt).collect::<Vec<_>>();
    let latest = history.first().cloned().unwrap_or(Value::Null);
    let decision: Value = task.get("decision_request");
    let files = sources
        .iter()
        .map(|source| {
            let sha256: String = source.get("source_sha256");
            let previous = source
                .get::<_, Option<String>>("previous_request_id")
                .map(|request| {
                    let previous_sha256: String = source.get("previous_sha256");
                    json!({
                        "kind": if previous_sha256 == sha256 { "identical" } else { "same_name" },
                        "requestId": request,
                "ordinal": source.get::<_, i32>("previous_ordinal"),
                        "fileName": source.get::<_, String>("previous_file_name"),
                        "sha256": previous_sha256
                    })
                });
            json!({
                "ordinal": source.get::<_, i32>("ordinal"),
                "fileName": source.get::<_, String>("file_name"),
                "sha256": sha256,
                "size": source.get::<_, i32>("size"),
                "previousMatch": previous
            })
        })
        .collect::<Vec<_>>();
    Ok(
        json!({"organizationId":scope.organization.to_string(),"requestId":task.get::<_,String>("request_id"),"companyId":task.get::<_,String>("company_id"),"conversationKey":task.get::<_,String>("conversation_key"),"status":task.get::<_,String>("state"),"warnings":task.get::<_,Value>("warnings"),"error":task.get::<_,Option<String>>("error"),"createdAt":task.get::<_,String>("created_at"),"preparation":task.get::<_,Option<Value>>("preparation_json"),"coverage":task.get::<_,Option<Value>>("coverage_json"),"preparationReceipt":task.get::<_,Option<Value>>("preparation_receipt_json"),"decision":decision,"decisionReceipt":latest,"decisionHistory":history,"files":files,"reviews":reviews.iter().map(|r|json!({"id":r.get::<_,String>("id"),"title":r.get::<_,String>("title"),"targetEntity":r.get::<_,String>("target_entity"),"total":r.get::<_,i32>("total"),"pending":r.get::<_,i32>("pending"),"confirmed":r.get::<_,i32>("confirmed"),"excluded":r.get::<_,i32>("excluded")})).collect::<Vec<_>>()}),
    )
}

async fn create(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<Submission>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    let (originals, hash) = decode_submission(&body)?;
    if let Some(preparation) = &body.preparation {
        managed_source::verify_submission(
            &state,
            &session,
            body.company_id,
            preparation,
            &originals,
        )
        .await?;
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    accept(&pool, scoped, &body, &originals, &hash).await?;
    Ok(Json(read_task(&pool, scoped, &body.request_id).await?))
}

async fn prepare_saved(
    pool: &deadpool_postgres::Pool,
    scoped: StorageScope<'_>,
    body: &Submission,
    originals: &[Original],
) -> Result<Json<Value>, ApiError> {
    let task = read_task(&pool, scoped, &body.request_id).await?;
    let mode = task["decision"]["selectedOptionId"]
        .as_str()
        .and_then(ProcessingMode::from_str);
    if task["status"] == "saved" && task["decision"]["status"] == "approved" {
        let mode = mode.ok_or_else(|| {
            ApiError::Conflict("file processing requires an approved mode".into())
        })?;
        let preparation = run_preparation(&body, mode).await.and_then(|p| {
            validate_preparation(&p, &originals, mode)?;
            Ok(p)
        });
        match preparation {
            Ok(prepared) => finish(&pool, scoped, &body.request_id, &prepared, mode).await?,
            Err(ApiError::BadRequest(error)) => {
                let client = pool.get().await.map_err(ApiError::internal)?;
                client.execute("UPDATE lumiere_platform.import_task SET state='failed',error=$5 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND state='saved'", &[&scoped.organization.to_string(),&scoped.company.to_string(),&scoped.actor,&body.request_id,&error]).await.map_err(ApiError::internal)?;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(Json(read_task(&pool, scoped, &body.request_id).await?))
}

async fn resume(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    if !valid_request_id(&request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
    };
    resume_task(&pool, scoped, &request).await
}

async fn resume_task(
    pool: &deadpool_postgres::Pool,
    scoped: StorageScope<'_>,
    request: &str,
) -> Result<Json<Value>, ApiError> {
    let task = read_task(&pool, scoped, request).await?;
    if task["status"] != "saved" {
        return Ok(Json(task));
    }
    let sources = {
        let client = pool.get().await.map_err(ApiError::internal)?;
        client.query("SELECT file_name,source_sha256,original_bytes FROM lumiere_platform.import_task_source WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 ORDER BY ordinal", &[&scoped.organization.to_string(),&scoped.company.to_string(),&scoped.actor,&request]).await.map_err(ApiError::internal)?
    };
    let originals = sources
        .iter()
        .map(|s| Original {
            file_name: s.get("file_name"),
            sha256: s.get("source_sha256"),
            bytes: s.get("original_bytes"),
        })
        .collect::<Vec<_>>();
    let body = Submission {
        company_id: scoped.company,
        request_id: request.to_owned(),
        conversation_key: task["conversationKey"]
            .as_str()
            .ok_or_else(|| ApiError::Internal("missing saved conversation".into()))?
            .to_owned(),
        files: originals
            .iter()
            .map(|s| SourceFile {
                file_name: s.file_name.clone(),
                content_base64: STANDARD.encode(&s.bytes),
            })
            .collect(),
        preparation: task
            .get("preparation")
            .filter(|value| !value.is_null())
            .cloned(),
    };
    prepare_saved(&pool, scoped, &body, &originals).await
}

/// Apply explicitly selected saved preparation rules to immutable task files.
/// The new task keeps the original task and every prior review unchanged.
pub(super) async fn create_prepared_task_from_saved_sources(
    pool: &deadpool_postgres::Pool,
    scoped: StorageScope<'_>,
    source_request: &str,
    request: &str,
    source_ordinals: &[i32],
    preparation: Value,
) -> Result<Value, ApiError> {
    if !valid_request_id(source_request)
        || !valid_request_id(request)
        || source_request == request
        || source_ordinals.is_empty()
        || source_ordinals.len() > 20
        || source_ordinals
            .iter()
            .any(|ordinal| !(0..20).contains(ordinal))
        || source_ordinals
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != source_ordinals.len()
    {
        return Err(ApiError::BadRequest(
            "choose unique saved files and a new preparation request identity".into(),
        ));
    }
    let source_task = read_task(pool, scoped, source_request).await?;
    if managed_source::has_selection(&source_task["preparation"])
        || managed_source::has_selection(&preparation)
    {
        return Err(ApiError::BadRequest(
            "open the managed document again to prepare a different selection".into(),
        ));
    }
    let client = pool.get().await.map_err(ApiError::internal)?;
    let saved = client.query("SELECT ordinal,file_name,original_bytes FROM lumiere_platform.import_task_source WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND ordinal=ANY($5::int[])", &[&scoped.organization.to_string(),&scoped.company.to_string(),&scoped.actor,&source_request,&source_ordinals]).await.map_err(ApiError::internal)?;
    if saved.len() != source_ordinals.len() {
        return Err(ApiError::NotFound(
            "selected original import file not found".into(),
        ));
    }
    let files = source_ordinals
        .iter()
        .map(|ordinal| {
            let row = saved
                .iter()
                .find(|row| row.get::<_, i32>("ordinal") == *ordinal)
                .ok_or_else(|| {
                    ApiError::NotFound("selected original import file not found".into())
                })?;
            Ok(SourceFile {
                file_name: row.get("file_name"),
                content_base64: STANDARD.encode(row.get::<_, Vec<u8>>("original_bytes")),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    drop(client);
    let body = Submission {
        company_id: scoped.company,
        request_id: request.into(),
        conversation_key: source_task["conversationKey"]
            .as_str()
            .ok_or_else(|| ApiError::Internal("saved task conversation is missing".into()))?
            .into(),
        files,
        preparation: Some(preparation),
    };
    let (originals, hash) = decode_submission(&body)?;
    accept(pool, scoped, &body, &originals, &hash).await?;
    let decision_id = hex::encode(Sha256::digest(format!(
        "import-recipe-prepare/v1\0{request}"
    )))[..32]
        .to_owned();
    save_decision(
        pool,
        scoped,
        request,
        &DecisionBody {
            company_id: scoped.company,
            decision_id,
            expected_revision: 1,
            option_id: "prepare_import".into(),
            other_text: None,
        },
    )
    .await?;
    Ok(resume_task(pool, scoped, request).await?.0)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReprepareBody {
    company_id: u64,
    request_id: String,
    preparation: Value,
}

async fn reprepare(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Json(body): Json<ReprepareBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let task = read_task(&pool, scoped, &request).await?;
    let ordinals = task["files"]
        .as_array()
        .ok_or_else(|| ApiError::Internal("saved task files are missing".into()))?
        .iter()
        .map(|file| {
            file["ordinal"]
                .as_i64()
                .and_then(|value| i32::try_from(value).ok())
                .ok_or_else(|| ApiError::Internal("saved file ordinal is invalid".into()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    create_prepared_task_from_saved_sources(
        &pool,
        scoped,
        &request,
        &body.request_id,
        &ordinals,
        body.preparation,
    )
    .await
    .map(Json)
}

async fn decide(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Json(body): Json<DecisionBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    if !valid_request_id(&request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let receipt = save_decision(&pool, scoped, &request, &body).await?;
    let mut task = resume_task(&pool, scoped, &request).await?.0;
    task["decisionReceipt"] = receipt;
    Ok(Json(task))
}

async fn read(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    if !valid_request_id(&request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
    };
    // Read immutable receipt first: the subsequent task snapshot must include
    // at least that committed revision, even if another answer arrives now.
    let receipt = match query.decision_id {
        Some(decision) => Some(read_decision(&pool, scoped, &request, &decision).await?),
        None => None,
    };
    let mut task = read_task(&pool, scoped, &request).await?;
    if let Some(receipt) = receipt {
        task["decisionReceipt"] = receipt;
    }
    Ok(Json(task))
}

async fn list(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<TaskQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: query.company_id,
        actor: context.actor_identity(),
    };
    let after = task_cursor(&task_cursor_secret(&state), scoped, &query)?;
    let after_time = after.as_ref().map(|value| value.created_at.as_str());
    let after_request = after.as_ref().map(|value| value.request_id.as_str());
    let requests = {
        let client = pool.get().await.map_err(ApiError::internal)?;
        client.query("SELECT request_id,created_at::text FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND ($4::text IS NULL OR conversation_key=$4) AND ($5::text IS NULL OR (created_at,request_id)<($5::text::timestamptz,$6)) ORDER BY created_at DESC,request_id DESC LIMIT 21", &[&scoped.organization.to_string(),&scoped.company.to_string(),&scoped.actor,&query.conversation_key,&after_time,&after_request]).await.map_err(ApiError::internal)?
    };
    let next_cursor = if requests.len() > 20 {
        requests
            .get(19)
            .map(|row| encode_task_cursor(&state, scoped, &query, row))
            .transpose()?
    } else {
        None
    };
    let mut tasks = Vec::with_capacity(requests.len().min(20));
    for row in requests.iter().take(20) {
        tasks.push(read_task(&pool, scoped, &row.get::<_, String>("request_id")).await?);
    }
    Ok(Json(json!({"tasks":tasks,"nextCursor":next_cursor})))
}

const TASK_CURSOR_AUDIENCE: &str = "lumiere-import-task-list/v1";

#[derive(Serialize, Deserialize)]
struct TaskCursor {
    aud: String,
    exp: u64,
    organization: String,
    company: String,
    actor: String,
    conversation: Option<String>,
    created_at: String,
    request_id: String,
}

fn task_cursor_secret(state: &AppState) -> Vec<u8> {
    Sha256::digest(format!("{TASK_CURSOR_AUDIENCE}\0{}", state.stdb.token())).to_vec()
}

fn task_cursor(
    secret: &[u8],
    scope: StorageScope<'_>,
    query: &TaskQuery,
) -> Result<Option<TaskCursor>, ApiError> {
    let Some(token) = query.cursor.as_deref() else {
        return Ok(None);
    };
    if token.len() > 4096 {
        return Err(ApiError::BadRequest("invalid import task cursor".into()));
    }
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_audience(&[TASK_CURSOR_AUDIENCE]);
    let cursor = decode::<TaskCursor>(token, &DecodingKey::from_secret(secret), &validation)
        .map_err(|_| ApiError::BadRequest("invalid or expired import task cursor".into()))?
        .claims;
    if cursor.organization != scope.organization.to_string()
        || cursor.company != scope.company.to_string()
        || cursor.actor != scope.actor
        || cursor.conversation != query.conversation_key
        || !valid_request_id(&cursor.request_id)
    {
        return Err(ApiError::BadRequest(
            "import task cursor belongs to another scope or filter".into(),
        ));
    }
    Ok(Some(cursor))
}

fn encode_task_cursor(
    state: &AppState,
    scope: StorageScope<'_>,
    query: &TaskQuery,
    row: &tokio_postgres::Row,
) -> Result<String, ApiError> {
    encode(
        &Header::new(Algorithm::HS256),
        &TaskCursor {
            aud: TASK_CURSOR_AUDIENCE.into(),
            exp: (chrono::Utc::now().timestamp() + 3600) as u64,
            organization: scope.organization.to_string(),
            company: scope.company.to_string(),
            actor: scope.actor.into(),
            conversation: query.conversation_key.clone(),
            created_at: row.get("created_at"),
            request_id: row.get("request_id"),
        },
        &EncodingKey::from_secret(&task_cursor_secret(state)),
    )
    .map_err(ApiError::internal)
}

async fn download(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path((request, ordinal)): Path<(String, i32)>,
    Query(query): Query<TaskQuery>,
) -> Result<Response, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    if !valid_request_id(&request) {
        return Err(ApiError::BadRequest(
            "invalid import request identity".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row=client.query_opt("SELECT file_name,original_bytes FROM lumiere_platform.import_task_source WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 AND ordinal=$5", &[&context.organization_id().to_string(),&query.company_id.to_string(),&context.actor_identity(),&request,&ordinal]).await.map_err(ApiError::internal)?.ok_or_else(||ApiError::NotFound("import source not found".into()))?;
    let filename = row.get::<_, String>("file_name");
    let disposition = HeaderValue::from_str(&format!(
        "attachment; filename*=UTF-8''{}",
        urlencoding::encode(&filename)
    ))
    .map_err(ApiError::internal)?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            ),
            (header::CONTENT_DISPOSITION, disposition),
            (
                header::X_CONTENT_TYPE_OPTIONS,
                HeaderValue::from_static("nosniff"),
            ),
        ],
        row.get::<_, Vec<u8>>("original_bytes"),
    )
        .into_response())
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import-tasks", get(list).post(create))
        .route("/import-tasks/:request", get(read))
        .route("/import-tasks/:request/files/:ordinal", get(download))
        .route("/import-tasks/:request/resume", axum::routing::post(resume))
        .route(
            "/import-tasks/:request/reprepare",
            axum::routing::post(reprepare),
        )
        .route(
            "/import-tasks/:request/decision",
            axum::routing::post(decide),
        )
        .layer(DefaultBodyLimit::max(28_000_000))
}
