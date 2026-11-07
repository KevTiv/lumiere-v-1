//! Immutable, actor/company-scoped rules learned from an accepted preparation.
//! Replay binds each slot to saved original bytes and creates a new review task.
use super::{model, pg_pool, scope, tasks, ApiError, AppState, OrgSession, StorageScope};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tokio_postgres::Row;

#[cfg(test)]
mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ScopeQuery {
    company_id: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SaveBody {
    company_id: u64,
    request_id: String,
    source_request_id: String,
    key: String,
    name: String,
    expected_version: i32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ApplyBody {
    company_id: u64,
    request_id: String,
    source_request_id: String,
    version: i32,
    bindings: Vec<Binding>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Binding {
    slot_key: String,
    ordinal: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RecipeDocument {
    format: String,
    slots: Vec<Slot>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Slot {
    key: String,
    label: String,
    format: SourceFormat,
    options: Rules,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SourceFormat {
    Csv,
    Xlsx,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Rules {
    #[serde(skip_serializing_if = "Option::is_none")]
    expected_layout_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    delimiter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    decimal_separator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    grouping_separator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date_order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sections: Option<Vec<Section>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Section {
    key: String,
    header_record: u32,
    first_record: u32,
    last_record: u32,
    target_entity: Target,
    expected_headers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    header_map: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aliases: Option<Vec<Alias>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transforms: Option<Vec<Transform>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_column: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity_namespace: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity_fields: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Target {
    Product,
    Contact,
    StockLocation,
    SourceObservation,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Alias {
    field: String,
    from: String,
    to: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Transform {
    field: String,
    operation: TextOperation,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum TextOperation {
    Trim,
    Uppercase,
    Lowercase,
}

#[derive(Debug)]
struct Source {
    ordinal: i32,
    name: String,
    sha256: String,
}

fn valid_request(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn source_format(name: &str) -> Result<SourceFormat, ApiError> {
    match name
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => Ok(SourceFormat::Csv),
        Some("xlsx") => Ok(SourceFormat::Xlsx),
        _ => Err(ApiError::BadRequest(
            "recipe slots support original CSV or XLSX files".into(),
        )),
    }
}

fn digest(value: &impl Serialize) -> Result<String, ApiError> {
    Ok(hex::encode(Sha256::digest(
        serde_json::to_vec(value).map_err(ApiError::internal)?,
    )))
}

fn snapshot(row: &Row) -> Value {
    let document: Value = row.get("document_json");
    json!({"companyId":row.get::<_,String>("company_id"), "key":row.get::<_,String>("recipe_key"),
        "name":row.get::<_,String>("name"), "version":row.get::<_,i32>("version"),
        "sha256":row.get::<_,String>("document_sha256"), "slots":document["slots"],
        "createdAt":row.get::<_,String>("created_at")})
}

const SNAPSHOT: &str =
    "company_id::text,recipe_key,name,version,document_sha256,document_json,created_at::text";

/// Saving is possible only after the existing worker accepted these exact rules.
/// Layout hashes are derived from its receipt, never supplied by the recipe caller.
fn recipe_document(
    preparation: &Value,
    coverage: &Value,
    sources: &[Source],
) -> Result<RecipeDocument, ApiError> {
    if preparation["version"] != 1 || coverage["version"] != 1 || coverage["complete"] != true {
        return Err(ApiError::Conflict(
            "resolve held source files before saving a reusable recipe".into(),
        ));
    }
    if preparation.as_object().is_none_or(|map| {
        map.keys()
            .any(|key| !["version", "files", "recipe"].contains(&key.as_str()))
    }) {
        return Err(ApiError::BadRequest(
            "unsupported preparation options cannot become a recipe".into(),
        ));
    }
    let files = preparation["files"]
        .as_array()
        .filter(|files| !files.is_empty() && files.len() <= 20)
        .ok_or_else(|| {
            ApiError::BadRequest(
                "choose explicit source preparation rules before saving a recipe".into(),
            )
        })?;
    let coverage_files = coverage["files"]
        .as_array()
        .ok_or_else(|| ApiError::Conflict("the source coverage receipt is missing".into()))?;
    let mut slots = Vec::with_capacity(files.len());
    let mut selected = BTreeSet::new();
    for file in files {
        let mut rules = file
            .as_object()
            .cloned()
            .ok_or_else(|| ApiError::BadRequest("invalid file preparation rules".into()))?;
        let name = rules
            .remove("fileName")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(|| {
                ApiError::BadRequest("file preparation needs an original filename".into())
            })?;
        let sha256 = rules
            .remove("sourceSha256")
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(|| {
                ApiError::BadRequest("file preparation needs its original fingerprint".into())
            })?;
        let source = sources
            .iter()
            .find(|source| source.name == name && source.sha256 == sha256)
            .ok_or_else(|| {
                ApiError::Conflict("preparation no longer matches the saved original files".into())
            })?;
        if !selected.insert(source.ordinal) {
            return Err(ApiError::BadRequest(
                "a recipe cannot configure the same file twice".into(),
            ));
        }
        let mut options: Rules = serde_json::from_value(Value::Object(rules))
            .map_err(|_| ApiError::BadRequest("unsupported file preparation rules".into()))?;
        if options.delimiter.is_none()
            && options.decimal_separator.is_none()
            && options.grouping_separator.is_none()
            && options.date_order.is_none()
            && options.sections.as_ref().is_none_or(Vec::is_empty)
        {
            return Err(ApiError::BadRequest(
                "choose locale or section rules before saving this source recipe".into(),
            ));
        }
        let receipt = coverage_files
            .iter()
            .find(|entry| {
                entry["fileName"] == name
                    && entry["sourceSha256"] == sha256
                    && entry["status"] == "prepared"
            })
            .ok_or_else(|| {
                ApiError::Conflict("this source does not have an accepted coverage receipt".into())
            })?;
        let layout = receipt["layoutSha256"]
            .as_str()
            .filter(|value| model::sha256(value))
            .ok_or_else(|| {
                ApiError::Conflict("prepare this source again to record its reusable layout".into())
            })?;
        if !receipt["sections"].as_array().is_some_and(|sections| {
            sections
                .iter()
                .any(|section| section["headerSha256"].as_str().is_some_and(model::sha256))
        }) {
            return Err(ApiError::BadRequest(
                "choose explicit section headers before reusing an unstructured source".into(),
            ));
        }
        options.expected_layout_sha256 = Some(layout.to_owned());
        slots.push(Slot {
            key: format!("source-{}", source.ordinal + 1),
            label: name.clone(),
            format: source_format(&name)?,
            options,
        });
    }
    slots.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(RecipeDocument {
        format: "lumiere-import-recipe/v1".into(),
        slots,
    })
}

fn materialize(
    document: &RecipeDocument,
    key: &str,
    version: i32,
    bindings: &[Binding],
    sources: &[Source],
) -> Result<(Value, Vec<i32>), ApiError> {
    if document.format != "lumiere-import-recipe/v1"
        || bindings.is_empty()
        || bindings.len() > 20
        || bindings.len() != document.slots.len()
    {
        return Err(ApiError::BadRequest(
            "bind every recipe source slot exactly once".into(),
        ));
    }
    if bindings
        .iter()
        .map(|binding| &binding.slot_key)
        .collect::<BTreeSet<_>>()
        .len()
        != bindings.len()
        || bindings
            .iter()
            .map(|binding| binding.ordinal)
            .collect::<BTreeSet<_>>()
            .len()
            != bindings.len()
    {
        return Err(ApiError::BadRequest(
            "recipe slots must use distinct saved files".into(),
        ));
    }
    let mut files = Vec::with_capacity(bindings.len());
    let mut ordinals = Vec::with_capacity(bindings.len());
    for slot in &document.slots {
        let binding = bindings
            .iter()
            .find(|binding| binding.slot_key == slot.key)
            .ok_or_else(|| {
                ApiError::BadRequest("a recipe source slot has no file binding".into())
            })?;
        let source = sources
            .iter()
            .find(|source| source.ordinal == binding.ordinal)
            .ok_or_else(|| {
                ApiError::BadRequest("a recipe binding is outside the saved source task".into())
            })?;
        if source_format(&source.name)? != slot.format
            || !slot
                .options
                .expected_layout_sha256
                .as_deref()
                .is_some_and(model::sha256)
        {
            return Err(ApiError::BadRequest(
                "choose the recipe's original source format and validated layout".into(),
            ));
        }
        let mut options = serde_json::to_value(&slot.options).map_err(ApiError::internal)?;
        options["fileName"] = json!(source.name);
        options["sourceSha256"] = json!(source.sha256);
        files.push(options);
        ordinals.push(source.ordinal);
    }
    Ok((
        json!({"version":1,"recipe":{"key":key,"version":version},"files":files}),
        ordinals,
    ))
}

async fn save_recipe(
    pool: &deadpool_postgres::Pool,
    scoped: StorageScope<'_>,
    body: &SaveBody,
) -> Result<Value, ApiError> {
    if !valid_request(&body.request_id)
        || !valid_request(&body.source_request_id)
        || !valid_key(&body.key)
        || body.expected_version < 0
        || body.expected_version == i32::MAX
        || body.name.trim().is_empty()
        || body.name.len() > 200
        || body.name.chars().any(char::is_control)
        || body.company_id != scoped.company
    {
        return Err(ApiError::BadRequest(
            "choose a recipe key, bounded name, current version and unique request identity".into(),
        ));
    }
    let request_sha256 = digest(body)?;
    let org = scoped.organization.to_string();
    let company = scoped.company.to_string();
    let mut client = pool.get().await.map_err(ApiError::internal)?;
    let tx = client.transaction().await.map_err(ApiError::internal)?;
    if let Some(row) = tx.query_opt(&format!("SELECT {SNAPSHOT},request_sha256 FROM lumiere_platform.import_recipe_version WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4"), &[&org,&company,&scoped.actor,&body.request_id]).await.map_err(ApiError::internal)? {
        if row.get::<_,String>("request_sha256") != request_sha256 { return Err(ApiError::Conflict("this recipe request identity already saved different rules".into())); }
        return Ok(snapshot(&row));
    }
    let task = tx.query_opt("SELECT state,approved_mode,preparation_json,coverage_json,preparation_receipt_json FROM lumiere_platform.import_task WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4", &[&org,&company,&scoped.actor,&body.source_request_id]).await.map_err(ApiError::internal)?
        .ok_or_else(||ApiError::NotFound("source import task not found".into()))?;
    let receipt: Option<Value> = task.get("preparation_receipt_json");
    if task.get::<_, String>("state") != "needs_review"
        || task.get::<_, Option<String>>("approved_mode").as_deref() != Some("prepare_import")
        || receipt.as_ref().is_none_or(|value| {
            value["engineVersion"] != "lumiere-import-preparation/2"
                || value["semantics"] != "deterministic_review_proposals"
        })
    {
        return Err(ApiError::Conflict(
            "finish source preparation before saving its reusable rules".into(),
        ));
    }
    let rows = tx.query("SELECT ordinal,file_name,source_sha256 FROM lumiere_platform.import_task_source WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 ORDER BY ordinal", &[&org,&company,&scoped.actor,&body.source_request_id]).await.map_err(ApiError::internal)?;
    let sources = rows.iter().map(source_row).collect::<Vec<_>>();
    let preparation: Option<Value> = task.get("preparation_json");
    let coverage: Option<Value> = task.get("coverage_json");
    let document = recipe_document(
        &preparation.unwrap_or(Value::Null),
        &coverage.unwrap_or(Value::Null),
        &sources,
    )?;
    let document_json = serde_json::to_value(&document).map_err(ApiError::internal)?;
    let document_sha256 = digest(&document_json)?;
    tx.execute("INSERT INTO lumiere_platform.import_recipe (organization_id,company_id,actor_identity,recipe_key) VALUES ($1::text::numeric,$2::text::numeric,$3,$4) ON CONFLICT DO NOTHING", &[&org,&company,&scoped.actor,&body.key]).await.map_err(ApiError::internal)?;
    let head = tx.query_one("SELECT latest_version FROM lumiere_platform.import_recipe WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND recipe_key=$4 FOR UPDATE", &[&org,&company,&scoped.actor,&body.key]).await.map_err(ApiError::internal)?;
    // A concurrent identical request can finish while this transaction waits.
    if let Some(row) = tx.query_opt(&format!("SELECT {SNAPSHOT},request_sha256 FROM lumiere_platform.import_recipe_version WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4"), &[&org,&company,&scoped.actor,&body.request_id]).await.map_err(ApiError::internal)? {
        if row.get::<_,String>("request_sha256") != request_sha256 { return Err(ApiError::Conflict("this recipe request identity already saved different rules".into())); }
        return Ok(snapshot(&row));
    }
    if head.get::<_, i32>("latest_version") != body.expected_version {
        return Err(ApiError::Conflict(
            "the recipe changed; reload its current version before saving".into(),
        ));
    }
    let version = body.expected_version + 1;
    let saved = tx.query_one(&format!("INSERT INTO lumiere_platform.import_recipe_version (organization_id,company_id,actor_identity,recipe_key,version,name,request_id,request_sha256,source_request_id,document_sha256,document_json) VALUES ($1::text::numeric,$2::text::numeric,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING {SNAPSHOT}"), &[&org,&company,&scoped.actor,&body.key,&version,&body.name,&body.request_id,&request_sha256,&body.source_request_id,&document_sha256,&document_json]).await.map_err(ApiError::internal)?;
    tx.execute("UPDATE lumiere_platform.import_recipe SET latest_version=$5 WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND recipe_key=$4", &[&org,&company,&scoped.actor,&body.key,&version]).await.map_err(ApiError::internal)?;
    tx.commit().await.map_err(ApiError::internal)?;
    Ok(snapshot(&saved))
}

fn source_row(row: &Row) -> Source {
    Source {
        ordinal: row.get("ordinal"),
        name: row.get("file_name"),
        sha256: row.get("source_sha256"),
    }
}

async fn list(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let rows = client.query("SELECT version.company_id::text,version.recipe_key,version.name,version.version,version.document_sha256,version.document_json,version.created_at::text FROM lumiere_platform.import_recipe head JOIN lumiere_platform.import_recipe_version version USING (organization_id,company_id,actor_identity,recipe_key) WHERE head.organization_id=$1::text::numeric AND head.company_id=$2::text::numeric AND head.actor_identity=$3 AND version.version=head.latest_version ORDER BY version.recipe_key LIMIT 100", &[&context.organization_id().to_string(),&query.company_id.to_string(),&context.actor_identity()]).await.map_err(ApiError::internal)?;
    Ok(Json(
        json!({"recipes":rows.iter().map(snapshot).collect::<Vec<_>>()}),
    ))
}

async fn save(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Json(body): Json<SaveBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    save_recipe(
        &pool,
        StorageScope {
            organization: context.organization_id(),
            company: body.company_id,
            actor: context.actor_identity(),
        },
        &body,
    )
    .await
    .map(Json)
}

async fn read_receipt(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(request): Path<String>,
    Query(query): Query<ScopeQuery>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, query.company_id).await?;
    if !valid_request(&request) {
        return Err(ApiError::BadRequest("invalid recipe save identity".into()));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let row = client.query_opt(&format!("SELECT {SNAPSHOT} FROM lumiere_platform.import_recipe_version WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4"), &[&context.organization_id().to_string(), &query.company_id.to_string(), &context.actor_identity(), &request]).await.map_err(ApiError::internal)?
        .ok_or_else(|| ApiError::NotFound("recipe save receipt not found".into()))?;
    Ok(Json(snapshot(&row)))
}

async fn apply(
    State(state): State<Arc<AppState>>,
    OrgSession { session, .. }: OrgSession,
    Path(key): Path<String>,
    Json(body): Json<ApplyBody>,
) -> Result<Json<Value>, ApiError> {
    let context = scope(&state, &session, body.company_id).await?;
    if !valid_key(&key)
        || !valid_request(&body.request_id)
        || !valid_request(&body.source_request_id)
        || body.version <= 0
    {
        return Err(ApiError::BadRequest(
            "choose an immutable recipe version and a new task request identity".into(),
        ));
    }
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let scoped = StorageScope {
        organization: context.organization_id(),
        company: body.company_id,
        actor: context.actor_identity(),
    };
    let client = pool.get().await.map_err(ApiError::internal)?;
    let org = scoped.organization.to_string();
    let company = scoped.company.to_string();
    let row = client.query_opt("SELECT document_json FROM lumiere_platform.import_recipe_version WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND recipe_key=$4 AND version=$5", &[&org,&company,&scoped.actor,&key,&body.version]).await.map_err(ApiError::internal)?
        .ok_or_else(||ApiError::NotFound("import recipe version not found".into()))?;
    let document: RecipeDocument =
        serde_json::from_value(row.get("document_json")).map_err(ApiError::internal)?;
    let rows = client.query("SELECT ordinal,file_name,source_sha256 FROM lumiere_platform.import_task_source WHERE organization_id=$1::text::numeric AND company_id=$2::text::numeric AND actor_identity=$3 AND request_id=$4 ORDER BY ordinal", &[&org,&company,&scoped.actor,&body.source_request_id]).await.map_err(ApiError::internal)?;
    let sources = rows.iter().map(source_row).collect::<Vec<_>>();
    if sources.is_empty() {
        return Err(ApiError::NotFound("source import task not found".into()));
    }
    let (preparation, ordinals) =
        materialize(&document, &key, body.version, &body.bindings, &sources)?;
    drop(client);
    tasks::create_prepared_task_from_saved_sources(
        &pool,
        scoped,
        &body.source_request_id,
        &body.request_id,
        &ordinals,
        preparation,
    )
    .await
    .map(Json)
}

pub(super) fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/import-recipes", get(list).post(save))
        .route("/import-recipes/requests/:request", get(read_receipt))
        .route("/import-recipes/:key/apply", post(apply))
}
