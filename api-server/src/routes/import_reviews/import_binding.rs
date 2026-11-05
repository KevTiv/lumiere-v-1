//! Bind reviewed export rows to an exact submission after validating saved facts.
use super::*;
use crate::document_blob_store as storage;
use lumiere_file_inspection::InspectedCsv;

pub(crate) fn binding_key(org: u64, company: u64, actor: &str, request: &str) -> String {
    let hash = hex::encode(Sha256::digest(format!(
        "review-import-v1:{org}:{company}:{actor}:{request}"
    )));
    format!("org-{org}/import-review-bindings/{}.meta.json", &hash[..32])
}

fn conflict() -> ApiError {
    ApiError::Conflict(
        "Submitted row no longer matches its confirmed source-review revision".into(),
    )
}

fn positive(value: &str) -> Result<i64, ApiError> {
    value
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(conflict)
}

#[allow(clippy::too_many_arguments)]
fn validate_row(
    entity: &str,
    headers: &[String],
    row: &[String],
    source: &Value,
    values: &Value,
    fields: &Value,
    batch: i64,
    item: i64,
    revision: i32,
    reason: &str,
) -> Result<(), ApiError> {
    let headers: Vec<String> = headers.iter().map(|header| header.to_lowercase()).collect();
    // Native imports lowercase headers and use the first matching column.
    // Reject duplicates so a reviewed second value cannot hide the first value
    // consumed by the reducer.
    if headers.iter().collect::<BTreeSet<_>>().len() != headers.len() {
        return Err(conflict());
    }
    let expected_fields = source
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(conflict)?;
    let confirmed: BTreeSet<&str> = fields
        .as_array()
        .ok_or_else(conflict)?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    let mut expected = BTreeMap::<String, String>::new();
    for field in expected_fields {
        let key = field
            .get("key")
            .and_then(Value::as_str)
            .ok_or_else(conflict)?;
        if field.get("export").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        // The shared native/API CSV parser trims decoded cells. Apply that
        // same normalization to saved values before comparing the submission.
        let value = values.get(key).and_then(Value::as_str).unwrap_or("").trim();
        if !value.is_empty() && !confirmed.contains(key) {
            return Err(conflict());
        }
        if expected.insert(key.to_lowercase(), value.into()).is_some() {
            return Err(conflict());
        }
    }
    let reference = source.get("source").ok_or_else(conflict)?;
    for (column, key) in [("_source_file", "file"), ("_source_sha256", "sha256")] {
        expected.insert(
            column.into(),
            reference
                .get(key)
                .and_then(Value::as_str)
                .ok_or_else(conflict)?
                .trim()
                .into(),
        );
    }
    expected.insert(
        "_source_row".into(),
        reference
            .get("row")
            .and_then(Value::as_u64)
            .ok_or_else(conflict)?
            .to_string(),
    );
    expected.insert("_review_item_id".into(), item.to_string());
    expected.insert("_review_revision".into(), revision.to_string());
    expected.insert("_review_reason".into(), reason.trim().into());
    let linked = matches!(entity, "product" | "stock_location" | "contact");
    let mut metadata = json!({});
    if linked {
        metadata = values
            .get("metadata")
            .and_then(Value::as_str)
            .filter(|raw| !raw.is_empty())
            .map(serde_json::from_str::<Value>)
            .transpose()
            .map_err(|_| conflict())?
            .unwrap_or_else(|| json!({}));
        let object = metadata.as_object_mut().ok_or_else(conflict)?;
        object.insert("source_review".into(),json!({"version":1,"batch_id":batch.to_string(),"item_id":item.to_string(),
        "revision":revision,"source_file":reference["file"],"source_row":reference["row"],"source_sha256":reference["sha256"],
        "row_basis":reference.get("rowBasis").and_then(Value::as_str).unwrap_or("source_line"),"decision_reason":reason}));
        if !headers.iter().any(|header| header == "metadata") {
            return Err(conflict());
        }
    }
    for (index, header) in headers.iter().enumerate() {
        let actual = row.get(index).ok_or_else(conflict)?;
        if header == "metadata" && linked {
            if serde_json::from_str::<Value>(actual).map_err(|_| conflict())? != metadata {
                return Err(conflict());
            }
        } else if expected
            .get(header)
            .map_or(!actual.is_empty(), |value| value != actual)
        {
            return Err(conflict());
        }
    }
    if expected
        .iter()
        .any(|(key, value)| !value.is_empty() && !headers.contains(key))
    {
        return Err(conflict());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_review_binding(
    state: &AppState,
    session: &crate::session::ApiSession,
    company: u64,
    entity: &str,
    request: &str,
    inspected: &InspectedCsv,
) -> Result<(), ApiError> {
    let Some(item_column) = inspected
        .headers
        .iter()
        .position(|value| value == "_review_item_id")
    else {
        return Ok(());
    };
    let revision_column = inspected
        .headers
        .iter()
        .position(|value| value == "_review_revision")
        .ok_or_else(conflict)?;
    if inspected.rows.is_empty() || inspected.rows.len() > 1000 {
        return Err(ApiError::BadRequest(
            "reviewed imports require 1 to 1000 rows".into(),
        ));
    }
    let context = scope(state, session, company).await?;
    let org = context.organization_id();
    let actor = context.actor_identity();
    let key = binding_key(org, company, actor, request);
    let pool = pg_pool::required_pool().map_err(ApiError::unavailable)?;
    let client = pool.get().await.map_err(ApiError::internal)?;
    let bindings = validated_review_rows(
        &client,
        org,
        company,
        entity,
        inspected,
        item_column,
        revision_column,
    )
    .await?;
    context.require_current_placement(&state.organization_placements)?;
    let receipt = json!({"version":1,"organizationId":org.to_string(),"companyId":company.to_string(),"actor":actor,
        "requestId":request,"entity":entity,"contentSha256":inspected.content_sha256,"rows":bindings});
    let bytes = serde_json::to_vec(&receipt).map_err(ApiError::internal)?;
    if bytes.len() > 1_000_000 {
        return Err(ApiError::BadRequest(
            "review import binding exceeds size limit".into(),
        ));
    }
    storage::put_immutable(
        &state.config.document_blob_store,
        &key,
        &bytes,
        "application/json",
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn validated_review_rows(
    client: &tokio_postgres::Client,
    org: u64,
    company: u64,
    entity: &str,
    inspected: &InspectedCsv,
    item_column: usize,
    revision_column: usize,
) -> Result<Vec<Value>, ApiError> {
    let mut bindings = Vec::with_capacity(inspected.rows.len());
    let mut seen = BTreeSet::new();
    for (index, row) in inspected.rows.iter().enumerate() {
        let item = positive(row.get(item_column).ok_or_else(conflict)?)?;
        let revision = positive(row.get(revision_column).ok_or_else(conflict)?)?;
        if !seen.insert(item) {
            return Err(conflict());
        }
        let saved=client.query_opt("SELECT item.id,item.batch_id,item.source_json,item.proposed_json,item.confirmed_fields,item.revision,item.state,item.reason,batch.target_entity FROM lumiere_platform.import_review_item item JOIN lumiere_platform.import_review_batch batch ON batch.id=item.batch_id AND batch.organization_id=item.organization_id AND batch.company_id=item.company_id WHERE item.organization_id=$1::text::numeric AND item.company_id=$2::text::numeric AND item.id=$3",&[&org.to_string(),&company.to_string(),&item]).await.map_err(ApiError::internal)?.ok_or_else(conflict)?;
        let batch: i64 = saved.get("batch_id");
        let target: String = saved.get("target_entity");
        let saved_revision: i32 = saved.get("revision");
        if target != entity
            || saved_revision as i64 != revision
            || saved.get::<_, String>("state") != "confirmed"
        {
            return Err(conflict());
        }
        let reason: Option<String> = saved.get("reason");
        validate_row(
            entity,
            &inspected.headers,
            row,
            &saved.get::<_, Value>("source_json"),
            &saved.get::<_, Value>("proposed_json"),
            &saved.get::<_, Value>("confirmed_fields"),
            batch,
            item,
            saved_revision,
            reason.as_deref().unwrap_or(""),
        )?;
        bindings.push(json!({"importRow":index+2,"batchId":batch.to_string(),"itemId":item.to_string(),"revision":saved_revision}));
    }
    Ok(bindings)
}

/// Return only an exact, previously validated review decision reference. Native
/// job identity and row number are supplied by the authorized import mapping.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn read_review_binding(
    store: &storage::DocumentBlobStoreConfig,
    org: u64,
    company: u64,
    actor: &str,
    request: &str,
    entity: &str,
    content_hash: &str,
    import_row: u64,
) -> Result<Option<Value>, ApiError> {
    let key = binding_key(org, company, actor, request);
    let Some(bytes) = storage::read(store, &key, 1_000_000).await? else {
        return Ok(None);
    };
    let receipt: Value = serde_json::from_slice(&bytes).map_err(|_| conflict())?;
    if receipt["version"] != 1
        || receipt["organizationId"] != org.to_string()
        || receipt["companyId"] != company.to_string()
        || receipt["actor"] != actor
        || receipt["requestId"] != request
        || receipt["entity"] != entity
        || receipt["contentSha256"] != content_hash
    {
        return Err(conflict());
    }
    let rows = receipt["rows"]
        .as_array()
        .filter(|rows| rows.len() <= 1000)
        .ok_or_else(conflict)?;
    let mut matched = None;
    for row in rows {
        if row["importRow"].as_u64() != Some(import_row) {
            continue;
        }
        if matched.is_some()
            || row["batchId"]
                .as_str()
                .and_then(|id| positive(id).ok())
                .is_none()
            || row["itemId"]
                .as_str()
                .and_then(|id| positive(id).ok())
                .is_none()
            || row["revision"]
                .as_i64()
                .filter(|rev| *rev > 0 && *rev <= i32::MAX as i64)
                .is_none()
        {
            return Err(conflict());
        }
        matched = Some(
            json!({"batchId":row["batchId"],"itemId":row["itemId"],"revision":row["revision"]}),
        );
    }
    Ok(matched)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn postgres_review_binding_uses_saved_scope_revision_and_confirmed_values(
    ) -> anyhow::Result<()> {
        if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
            return Ok(());
        }
        let mut config = pg_pool::PgConfig::from_env()?;
        config.database = "postgres".into();
        let admin = pg_pool::build_pool(&config)?;
        let database = format!(
            "review_binding_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_micros()
        );
        admin
            .get()
            .await?
            .batch_execute(&format!("CREATE DATABASE {database}"))
            .await?;
        config.database.clone_from(&database);
        let pool = pg_pool::build_pool(&config)?;
        let result = exercise_saved_review(&pool).await;
        drop(pool);
        let cleanup = admin
            .get()
            .await?
            .batch_execute(&format!("DROP DATABASE {database} WITH (FORCE)"))
            .await;
        result?;
        cleanup?;
        Ok(())
    }

    async fn exercise_saved_review(pool: &deadpool_postgres::Pool) -> anyhow::Result<()> {
        let client = pool.get().await?;
        client
            .batch_execute("CREATE SCHEMA lumiere_platform")
            .await?;
        client
            .batch_execute(include_str!("../../cold_tier/import_review_expand.sql"))
            .await?;
        client
            .batch_execute(include_str!(
                "../../cold_tier/import_review_fields_expand.sql"
            ))
            .await?;
        client.execute("INSERT INTO lumiere_platform.import_review_batch (id,organization_id,company_id,title,target_entity,source_file,source_sha256,created_by) VALUES (3,42,7,'Historical review','account_move','a.csv',$1,'actor')",&[&"a".repeat(64)]).await?;
        let source = json!({"fields":[{"key":"name"}],"source":{"file":"a.csv","row":8,"sha256":"a".repeat(64)}});
        client.execute("INSERT INTO lumiere_platform.import_review_item (id,organization_id,company_id,batch_id,source_key,source_json,proposed_json,state,revision,reason,confirmed_fields) VALUES (9,42,7,3,'row-8',$1,$2,'confirmed',2,'Confirmed',$3)",&[&source,&json!({"name":"Acme"}),&json!(["name"])]).await?;
        let csv=format!("name,_source_file,_source_row,_source_sha256,_review_item_id,_review_revision,_review_reason\nAcme,a.csv,8,{},9,2,Confirmed\n","a".repeat(64));
        let inspected = lumiere_file_inspection::inspect_csv(&csv)?;
        let bindings =
            validated_review_rows(&client, 42, 7, "account_move", &inspected, 4, 5).await?;
        anyhow::ensure!(
            bindings == vec![json!({"importRow":2,"batchId":"3","itemId":"9","revision":2})]
        );
        for (org, company, entity) in [
            (43, 7, "account_move"),
            (42, 8, "account_move"),
            (42, 7, "product"),
        ] {
            anyhow::ensure!(
                validated_review_rows(&client, org, company, entity, &inspected, 4, 5)
                    .await
                    .is_err()
            );
        }
        for changed in [
            csv.replace("Acme,", "Changed,"),
            csv.replace("a.csv,", "forged.csv,"),
            csv.replace(",9,2,", ",9,1,"),
        ] {
            let changed = lumiere_file_inspection::inspect_csv(&changed)?;
            anyhow::ensure!(
                validated_review_rows(&client, 42, 7, "account_move", &changed, 4, 5)
                    .await
                    .is_err()
            );
        }
        client.execute("UPDATE lumiere_platform.import_review_item SET revision=3,proposed_json=$1 WHERE id=9",&[&json!({"name":"New name"})]).await?;
        anyhow::ensure!(
            validated_review_rows(&client, 42, 7, "account_move", &inspected, 4, 5)
                .await
                .is_err()
        );
        let corrected = lumiere_file_inspection::inspect_csv(
            &csv.replace("Acme,", "New name,").replace(",9,2,", ",9,3,"),
        )?;
        anyhow::ensure!(
            validated_review_rows(&client, 42, 7, "account_move", &corrected, 4, 5).await?[0]
                ["revision"]
                == 3
        );
        client
            .execute(
                "UPDATE lumiere_platform.import_review_item SET state='excluded' WHERE id=9",
                &[],
            )
            .await?;
        anyhow::ensure!(
            validated_review_rows(&client, 42, 7, "account_move", &corrected, 4, 5)
                .await
                .is_err()
        );
        Ok(())
    }
    #[test]
    fn review_binding_rejects_changed_fields_missing_values_and_forged_source() {
        let headers: Vec<String> = [
            "name",
            "_source_file",
            "_source_row",
            "_source_sha256",
            "_review_item_id",
            "_review_revision",
            "_review_reason",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let row: Vec<String> = [
            "Acme",
            "source.csv",
            "8",
            &"a".repeat(64),
            "9",
            "2",
            "Confirmed",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let source = json!({"fields":[{"key":"name"}],"source":{"file":"source.csv","row":8,"sha256":"a".repeat(64)}});
        let values = json!({"name":"Acme"});
        let fields = json!(["name"]);
        assert!(validate_row(
            "account_move",
            &headers,
            &row,
            &source,
            &values,
            &fields,
            3,
            9,
            2,
            "Confirmed"
        )
        .is_ok());
        for index in [0, 1, 2, 3, 4, 5, 6] {
            let mut changed = row.clone();
            changed[index] = "forged".into();
            assert!(validate_row(
                "account_move",
                &headers,
                &changed,
                &source,
                &values,
                &fields,
                3,
                9,
                2,
                "Confirmed"
            )
            .is_err());
        }
        assert!(validate_row(
            "account_move",
            &headers,
            &row,
            &source,
            &values,
            &json!([]),
            3,
            9,
            2,
            "Confirmed"
        )
        .is_err());
    }

    #[tokio::test]
    async fn retained_review_binding_is_exact_and_does_not_infer_legacy_references() {
        let root =
            std::env::temp_dir().join(format!("history-review-binding-{}", rand::random::<u64>()));
        let store = storage::DocumentBlobStoreConfig::Local { root: root.clone() };
        let actor = "a".repeat(64);
        let request = "b".repeat(32);
        let content = "c".repeat(64);
        assert!(
            read_review_binding(&store, 42, 7, &actor, &request, "product", &content, 2)
                .await
                .unwrap()
                .is_none()
        );
        let key = binding_key(42, 7, &actor, &request);
        let receipt = json!({"version":1,"organizationId":"42","companyId":"7","actor":actor,
            "requestId":request,"entity":"product","contentSha256":content,
            "rows":[{"importRow":2,"batchId":"9007199254740993","itemId":"9007199254740995","revision":2}]});
        storage::put_immutable(
            &store,
            &key,
            &serde_json::to_vec(&receipt).unwrap(),
            "application/json",
        )
        .await
        .unwrap();
        let found = read_review_binding(&store, 42, 7, &actor, &request, "product", &content, 2)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            found,
            json!({"batchId":"9007199254740993","itemId":"9007199254740995","revision":2})
        );
        assert!(
            read_review_binding(&store, 42, 7, &actor, &request, "product", &content, 3)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            read_review_binding(&store, 42, 8, &actor, &request, "product", &content, 2)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            read_review_binding(&store, 42, 7, &actor, &request, "contact", &content, 2)
                .await
                .is_err()
        );
        assert!(read_review_binding(
            &store,
            42,
            7,
            &actor,
            &request,
            "product",
            &"d".repeat(64),
            2
        )
        .await
        .is_err());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn linked_metadata_must_match_the_saved_decision_and_all_exported_values() {
        let headers: Vec<String> = [
            "name",
            "metadata",
            "_source_file",
            "_source_row",
            "_source_sha256",
            "_review_item_id",
            "_review_revision",
            "_review_reason",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let source = json!({"fields":[{"key":"name"}],"source":{"file":"a.csv","row":8,"sha256":"a".repeat(64)}});
        let metadata = json!({"source_review":{"version":1,"batch_id":"3","item_id":"9","revision":2,"source_file":"a.csv","source_row":8,"source_sha256":"a".repeat(64),"row_basis":"source_line","decision_reason":"Confirmed"}});
        let row: Vec<String> = [
            "Acme".into(),
            metadata.to_string(),
            "a.csv".into(),
            "8".into(),
            "a".repeat(64),
            "9".into(),
            "2".into(),
            "Confirmed".into(),
        ]
        .into_iter()
        .collect();
        assert!(validate_row(
            "product",
            &headers,
            &row,
            &source,
            &json!({"name":"Acme"}),
            &json!(["name"]),
            3,
            9,
            2,
            "Confirmed"
        )
        .is_ok());
        let mut changed = row.clone();
        changed[1] = json!({"source_review":{"batch_id":"999"}}).to_string();
        assert!(validate_row(
            "product",
            &headers,
            &changed,
            &source,
            &json!({"name":"Acme"}),
            &json!(["name"]),
            3,
            9,
            2,
            "Confirmed"
        )
        .is_err());
        assert!(validate_row(
            "product",
            &headers[1..],
            &row[1..],
            &source,
            &json!({"name":"Acme"}),
            &json!(["name"]),
            3,
            9,
            2,
            "Confirmed"
        )
        .is_err());
        let mut duplicate_headers = headers.clone();
        duplicate_headers.insert(0, "Name".into());
        let mut duplicate_row = row.clone();
        duplicate_row.insert(0, String::new());
        assert!(validate_row(
            "product",
            &duplicate_headers,
            &duplicate_row,
            &source,
            &json!({"name":"Acme"}),
            &json!(["name"]),
            3,
            9,
            2,
            "Confirmed"
        )
        .is_err());
    }
}
