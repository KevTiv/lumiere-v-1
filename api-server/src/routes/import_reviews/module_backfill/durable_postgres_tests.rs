//! Persistence proof using the same scoped transaction as the original route and worker.
use anyhow::{ensure, Context};
use serde_json::json;

use super::{apply_reviewed_rows, workflow_results, Module, PreparedTask, Selection, WriteBody};
use crate::{error::ApiError, routes::import_reviews::StorageScope};

pub(in crate::routes::import_reviews) async fn exercise_shop_sales_volume(
    pool: &deadpool_postgres::Pool,
) -> anyhow::Result<()> {
    let mut client = pool.get().await?;
    client
        .batch_execute(concat!(
            include_str!("../../../cold_tier/import_task_inspection_expand.sql"),
            include_str!("../../../cold_tier/module_backfill_provenance_expand.sql"),
        ))
        .await?;
    let scope = StorageScope {
        organization: 8003,
        company: 9003,
        actor: "volume-shop-reviewer",
    };
    let task_id = "e".repeat(32);
    let hash = "e".repeat(64);
    let batch = client.query_one(
        "INSERT INTO lumiere_platform.import_review_batch
            (organization_id, company_id, title, target_entity, source_file, source_sha256, created_by)
         VALUES (8003, 9003, '907 Shop Sales', 'source_observation', 'shop-sales.csv', $1, $2)
         RETURNING id",
        &[&hash, &scope.actor],
    ).await?.get::<_, i64>(0);
    client.execute(
        "INSERT INTO lumiere_platform.import_task
            (organization_id, company_id, actor_identity, request_id, conversation_key, request_sha256,
             state, approved_mode, decision_request)
         VALUES (8003, 9003, $1, $2, 'shop-sales-volume', $3, 'needs_review', 'prepare_import', '{}')",
        &[&scope.actor, &task_id, &hash],
    ).await?;
    client
        .execute(
            "INSERT INTO lumiere_platform.import_task_review
            (organization_id, company_id, actor_identity, request_id, batch_id)
         VALUES (8003, 9003, $1, $2, $3)",
            &[&scope.actor, &task_id, &batch],
        )
        .await?;

    let values = [
        ("shop", "Volume shop"),
        ("sale_date", "2024-04-12"),
        ("product_label", "Whole chicken"),
        ("sold_quantity", "2.5"),
        ("sale_unit_price", "2500"),
        ("sale_amount", "6250"),
        ("currency_code", "RWF"),
    ];
    let proposed = values
        .iter()
        .copied()
        .collect::<std::collections::BTreeMap<_, _>>();
    let fields = values.iter().map(|(key, value)| {
        json!({"key":key, "label":key, "kind":"text", "sourceValue":value, "required":true})
    }).collect::<Vec<_>>();
    let source = json!({
        "key":"shop-volume","label":"Shop sale","issue":"Reviewed",
        "source":{"file":"shop-sales.csv","row":1,"sha256":hash},
        "fields":fields,"proposed":proposed,
    });
    let item_ids = client.query(
        "INSERT INTO lumiere_platform.import_review_item
            (organization_id, company_id, batch_id, source_key, source_json, proposed_json, state, revision)
         SELECT 8003, 9003, $1, 'sale-' || number,
                jsonb_set($2::jsonb, '{source,row}', to_jsonb(number)), $2::jsonb->'proposed', 'confirmed', 2
         FROM generate_series(1,907) AS rows(number)
         RETURNING id",
        &[&batch,&source],
    ).await?.into_iter().map(|row| row.get::<_, i64>(0)).collect::<Vec<_>>();
    ensure!(item_ids.len() == 907);

    let binding = || {
        Some(PreparedTask {
            actor: scope.actor,
            request: &task_id,
        })
    };
    let body = |rows, preview| WriteBody {
        company_id: scope.company,
        module: Module::ShopSales,
        rows,
        preview,
    };
    let mut first_chunk = None;
    let mut receipts = Vec::with_capacity(item_ids.len());
    for ids in item_ids.chunks(200) {
        let rows = ids
            .iter()
            .map(|id| Selection {
                item_id: id.to_string(),
                revision: 2,
                customer_id: None,
                expected_digest: None,
            })
            .collect();
        let tx = client.transaction().await?;
        let preview =
            apply_reviewed_rows(&tx, scope, batch, body(rows, true), binding(), &[]).await?;
        let approved = preview["results"]
            .as_array()
            .context("missing preview outcomes")?
            .iter()
            .map(|row| {
                ensure!(row["status"] == "ready");
                Ok(Selection {
                    item_id: row["itemId"]
                        .as_str()
                        .context("missing item ID")?
                        .to_owned(),
                    revision: 2,
                    customer_id: None,
                    expected_digest: Some(
                        row["digest"]
                            .as_str()
                            .context("missing preview digest")?
                            .to_owned(),
                    ),
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        if first_chunk.is_none() {
            let mut stale = approved[0].clone();
            stale.expected_digest = Some("0".repeat(64));
            let stale =
                apply_reviewed_rows(&tx, scope, batch, body(vec![stale], false), binding(), &[])
                    .await?;
            ensure!(stale["results"][0]["status"] == "held");
            let mut stale = approved[1].clone();
            stale.revision = 1;
            let stale =
                apply_reviewed_rows(&tx, scope, batch, body(vec![stale], false), binding(), &[])
                    .await?;
            ensure!(stale["results"][0]["status"] == "held");
            let unlinked = Some(PreparedTask {
                actor: "wrong-reviewer",
                request: &task_id,
            });
            ensure!(matches!(
                apply_reviewed_rows(
                    &tx,
                    scope,
                    batch,
                    body(vec![approved[0].clone()], false),
                    unlinked,
                    &[]
                )
                .await,
                Err(ApiError::Conflict(_))
            ));
            let count = workflow_results(&tx, scope, &task_id).await?;
            ensure!(count["counts"] == json!({"verified":0,"alreadyPresent":0}));
        }
        let saved = apply_reviewed_rows(
            &tx,
            scope,
            batch,
            body(approved.clone(), false),
            binding(),
            &[],
        )
        .await?;
        tx.commit().await?;
        let results = saved["results"]
            .as_array()
            .context("missing chunk outcomes")?;
        ensure!(results.len() == ids.len() && results.iter().all(|row| row["status"] == "saved"));
        receipts.extend(results.iter().map(|row| row["recordId"].clone()));
        if first_chunk.is_none() {
            first_chunk = Some((approved, saved));
        }
    }
    drop(client);

    // A different worker recovers the first completed chunk after its receipt was lost.
    let (rows, first_receipt) = first_chunk.context("no chunk persisted")?;
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    ensure!(
        apply_reviewed_rows(&tx, scope, batch, body(rows, false), binding(), &[]).await?
            == first_receipt,
        "a lost chunk receipt must replay to its original exact records",
    );
    let mut distinct_ids = receipts
        .iter()
        .filter_map(|id| id.as_str())
        .collect::<Vec<_>>();
    distinct_ids.sort_unstable();
    distinct_ids.dedup();
    ensure!(distinct_ids.len() == 907);
    let summary = workflow_results(&tx, scope, &task_id).await?;
    ensure!(summary["counts"] == json!({"verified":907,"alreadyPresent":0}));
    ensure!(summary["salesTotals"] == json!([{"currency":"RWF","amount":"5668750","count":907}]));
    tx.commit().await?;
    Ok(())
}
