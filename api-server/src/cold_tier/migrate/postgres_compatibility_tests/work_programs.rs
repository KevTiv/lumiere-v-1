//! Real PostgreSQL 34→35 upgrade and restart preservation for private reusable work.
//!
//! These are storage fixtures, not runtime certification, knowledge approval or
//! executable publication. Exact row snapshots include immutable draft receipts,
//! source nominations, recipe bindings and append-only revocation evidence.

use super::*;
use sha2::{Digest, Sha256};

const WORK_TABLES: [&str; 5] = [
    "ai_work_program",
    "ai_work_program_version",
    "ai_work_program_output_nomination",
    "ai_work_program_recipe",
    "ai_work_program_recipe_revocation",
];
const SOURCE_TABLES: [&str; 3] = [
    "ai_run_queued_input",
    "knowledge_guide",
    "knowledge_guide_revision",
];

#[tokio::test]
async fn postgres_work_programs_34_to_35_preserves_sources_versions_and_revocation() -> Result<()> {
    if std::env::var("C4_TEST_PG").as_deref() != Ok("1") {
        eprintln!("skipping work program migration proof (set C4_TEST_PG=1 to run)");
        return Ok(());
    }
    let base = pg_pool::PgConfig::from_env()?;
    let database = unique_database_name()?;
    let admin = admin_pool(&base)?;
    create_database(&admin, &database, &base.user).await?;
    let mut config = base;
    config.database.clone_from(&database);
    let result = exercise_work_program_upgrade(&config).await;
    let cleanup = drop_database(&admin, &database).await;
    result?;
    cleanup?;
    Ok(())
}

async fn exercise_work_program_upgrade(config: &pg_pool::PgConfig) -> Result<()> {
    let index = MIGRATIONS
        .iter()
        .position(|migration| migration.version == 35)
        .context("work program migration 35 is present")?;
    ensure!(index > 0 && MIGRATIONS[index - 1].version == 34);
    ensure!(MIGRATIONS[index - 1].name == "chat_import_tasks");
    let migration = MIGRATIONS[index];
    ensure!(migration.name == "alpha_reusable_work");
    ensure!(migration.change_set == 24 && migration.phase.as_str() == "expand");
    ensure!(
        migration.sql
            == include_str!(
        "../../../../../lumiere-codegen/pg-migration-ledger/0035_durable_projection_delta.sql"
    )
    );

    let pool = pg_pool::build_pool(config)?;
    apply_migration_prefix(&pool, index).await?;
    let previous_history = applied_migration_history(&pool).await?;
    ensure!(previous_history.len() == index);
    seed_source_rows(&pool).await?;
    let source_rows = snapshots(&pool, &SOURCE_TABLES).await?;
    for table in WORK_TABLES {
        ensure!(
            !relation_exists(&pool, table).await?,
            "{table} predates migration 35"
        );
    }

    ensure_schema(&pool).await?;
    let upgraded_history = applied_migration_history(&pool).await?;
    ensure!(upgraded_history.len() == MIGRATIONS.len());
    ensure!(
        upgraded_history[..previous_history.len()] == previous_history,
        "upgrade changed a released migration identity, checksum, phase or applied_at"
    );
    ensure!(applied_checksum(&pool, 35).await? == migration_checksum(migration.sql));
    ensure!(snapshots(&pool, &SOURCE_TABLES).await? == source_rows);
    for table in WORK_TABLES {
        ensure!(
            relation_exists(&pool, table).await?,
            "{table} was not added"
        );
    }

    seed_work_rows(&pool).await?;
    let work_rows = snapshots(&pool, &WORK_TABLES).await?;
    ensure!(
        work_rows.len() == 8,
        "expected head, two versions, nomination, two recipes and two revocations"
    );
    assert_exact_links(&pool).await?;

    // Startup replay must preserve all old source rows, immutable versions,
    // actor request identities and both tenants' revocations byte-for-byte.
    ensure_schema(&pool).await?;
    ensure!(applied_migration_history(&pool).await? == upgraded_history);
    ensure!(snapshots(&pool, &SOURCE_TABLES).await? == source_rows);
    ensure!(snapshots(&pool, &WORK_TABLES).await? == work_rows);
    drop(pool);

    // A fresh API pool observes the same canonical state; no startup migration
    // resurrects a revoked recipe or overwrites a prior manifest with the head.
    let restarted = pg_pool::build_pool(config)?;
    ensure_schema(&restarted).await?;
    ensure!(applied_migration_history(&restarted).await? == upgraded_history);
    ensure!(snapshots(&restarted, &SOURCE_TABLES).await? == source_rows);
    ensure!(snapshots(&restarted, &WORK_TABLES).await? == work_rows);
    assert_exact_links(&restarted).await?;
    Ok(())
}

async fn snapshots(pool: &Pool, tables: &[&str]) -> Result<Vec<(String, String)>> {
    let client = pool.get().await?;
    let mut result = Vec::new();
    for table in tables {
        // Names come only from the fixed fixture lists above, never user input.
        let key = if *table == "ai_run_queued_input" {
            "queued_input_id"
        } else if *table == "ai_work_program_recipe_revocation" {
            "recipe_id"
        } else {
            "id"
        };
        let rows = client.query(
            &format!("SELECT row_to_json(snapshot)::TEXT FROM {table} AS snapshot ORDER BY organization_id, {key}"),
            &[],
        ).await?;
        for row in rows {
            result.push(((*table).to_string(), row.get(0)));
        }
    }
    Ok(result)
}

async fn seed_source_rows(pool: &Pool) -> Result<()> {
    pool.get().await?.batch_execute(
        "INSERT INTO ai_run_queued_input
         (queued_input_id,organization_id,company_id,run_id,idempotency_key,
          request_hash,position,revision,author,payload,status,create_date,write_date)
         VALUES (9007199254740997,8001,9001,9007199254740999,'work-upgrade-queue',
                 repeat('1',64),1,2,decode(repeat('11',32),'hex'),
                 '{\"text\":\"Keep queued source work\"}','queued',1762000000000001,1762000000000002);
         INSERT INTO knowledge_guide
         (id,organization_id,company_id,module,latest_revision,review_state,create_uid,create_date,write_date)
         VALUES (9007199254740993,8001,9001,'accounting',1,'draft',
                 decode(repeat('11',32),'hex'),1762000000000001,1762000000000002);
         INSERT INTO knowledge_guide_revision
         (id,organization_id,company_id,guide_id,revision,title,markdown,language,draft_key,
          sources_json,content_hash,request_key,request_hash,create_uid,create_date)
         VALUES (9007199254740995,8001,9001,9007199254740993,1,'Keep source guide',
                 'Original source observations','en','work-upgrade-guide','[]',repeat('2',64),
                 'work-upgrade-guide-save',repeat('3',64),decode(repeat('11',32),'hex'),1762000000000001)"
    ).await?;
    Ok(())
}

async fn seed_work_rows(pool: &Pool) -> Result<()> {
    pool.get().await?.batch_execute(
        "INSERT INTO ai_work_program
         (id,scope_key,organization_id,company_id,owner_identity,program_key,current_revision,created_at,updated_at)
         VALUES (9007199254740993,'8001:9001:' || repeat('11',32) || ':accounting-review',8001,9001,
                 decode(repeat('11',32),'hex'),'accounting-review',2,1762000000000001,1762000000000002);
         INSERT INTO ai_work_program_version
         (id,request_key,request_hash,organization_id,company_id,owner_identity,program_id,revision,
          manifest_json,manifest_hash,graph_hash,application_contract,reviewed_skill_key,created_at)
         VALUES (9007199254740995,'work-save-1',repeat('a',64),8001,9001,decode(repeat('11',32),'hex'),
                 9007199254740993,1,'{\"schemaVersion\":1,\"programKey\":\"accounting-review\",\"version\":1,\"module\":\"accounting\",\"reviewedSkillKey\":\"report_analysis\",\"applicationContract\":\"contracts-upgrade-fixture\",\"graphHash\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"inputSchemaRef\":\"report-input@1\",\"outputSchemaRef\":\"report-output@1\",\"codeArtifacts\":[],\"runtimeProfiles\":[]}',repeat('b',64),repeat('c',64),
                 'contracts-upgrade-fixture','report_analysis',1762000000000001),
                (18446744073709551615,'work-save-2',repeat('d',64),8001,9001,decode(repeat('11',32),'hex'),
                 9007199254740993,2,'{\"schemaVersion\":1,\"programKey\":\"accounting-review\",\"version\":2,\"module\":\"accounting\",\"reviewedSkillKey\":\"report_analysis\",\"applicationContract\":\"contracts-upgrade-fixture\",\"graphHash\":\"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\",\"inputSchemaRef\":\"report-input@1\",\"outputSchemaRef\":\"report-output@1\",\"codeArtifacts\":[],\"runtimeProfiles\":[]}',repeat('e',64),repeat('f',64),
                 'contracts-upgrade-fixture','report_analysis',1762000000000002);
         INSERT INTO ai_work_program_output_nomination
         (id,request_key,request_hash,organization_id,company_id,owner_identity,program_version_id,
          source_run_id,source_artifact_index,source_artifact_hash,source_artifact_bytes,created_at)
         VALUES (9007199254740997,'work-output-1',repeat('4',64),8001,9001,decode(repeat('11',32),'hex'),
                 18446744073709551615,9007199254740999,0,repeat('5',64),128,1762000000000003);
         INSERT INTO ai_work_program_recipe
         (id,request_key,organization_id,company_id,program_ref,graph_hash,application_contract,
          knowledge_version_id,knowledge_review_epoch,source_case_ids,payload_hash,created_by,created_at)
         VALUES (18446744073709551615,'work-recipe',8001,9001,'accounting-review@2',repeat('f',64),
                 'contracts-upgrade-fixture',9007199254740995,2,
                 '[9007199254741001,9007199254741003]',repeat('6',64),decode(repeat('11',32),'hex'),1762000000000004),
                (18446744073709551615,'work-recipe',8002,9002,'other-tenant-review@1',repeat('7',64),
                 'contracts-upgrade-fixture',9007199254741005,1,
                 '[9007199254741007,9007199254741009]',repeat('8',64),decode(repeat('22',32),'hex'),1762000000000004);
         INSERT INTO ai_work_program_recipe_revocation
         (recipe_id,organization_id,company_id,reason,revoked_by,revoked_at)
         VALUES (18446744073709551615,8001,9001,'Source changed',decode(repeat('33',32),'hex'),1762000000000005),
                (18446744073709551615,8002,9002,'Other tenant source changed',decode(repeat('44',32),'hex'),1762000000000006)"
    ).await?;
    // Hash the exact fixture bytes without requiring a PostgreSQL extension.
    let client = pool.get().await?;
    for row in client
        .query(
            "SELECT id::TEXT,manifest_json FROM ai_work_program_version WHERE organization_id=8001",
            &[],
        )
        .await?
    {
        let id: String = row.get(0);
        let manifest: String = row.get(1);
        let hash = hex::encode(Sha256::digest(manifest.as_bytes()));
        ensure!(client.execute(
            "UPDATE ai_work_program_version SET manifest_hash=$1 WHERE organization_id=8001 AND id=$2::TEXT::NUMERIC",
            &[&hash, &id],
        ).await? == 1);
    }
    Ok(())
}

async fn assert_exact_links(pool: &Pool) -> Result<()> {
    let client = pool.get().await?;
    let head = client.query_one(
        "SELECT id::TEXT,current_revision::TEXT FROM ai_work_program WHERE organization_id=8001", &[]
    ).await?;
    ensure!(head.get::<_, String>(0) == "9007199254740993");
    ensure!(head.get::<_, String>(1) == "2");
    let versions: Vec<(String, String)> = client.query(
        "SELECT id::TEXT,revision::TEXT FROM ai_work_program_version WHERE organization_id=8001 ORDER BY revision", &[]
    ).await?.into_iter().map(|row| (row.get(0),row.get(1))).collect();
    ensure!(
        versions
            == vec![
                ("9007199254740995".into(), "1".into()),
                ("18446744073709551615".into(), "2".into())
            ]
    );
    for row in client.query(
        "SELECT manifest_json,manifest_hash FROM ai_work_program_version WHERE organization_id=8001", &[]
    ).await? {
        let manifest: String = row.get(0);
        let hash: String = row.get(1);
        ensure!(hash == hex::encode(Sha256::digest(manifest.as_bytes())));
    }
    let nomination = client.query_one(
        "SELECT program_version_id::TEXT,source_run_id::TEXT,source_artifact_hash FROM ai_work_program_output_nomination WHERE organization_id=8001", &[]
    ).await?;
    ensure!(nomination.get::<_, String>(0) == "18446744073709551615");
    ensure!(nomination.get::<_, String>(1) == "9007199254740999");
    ensure!(nomination.get::<_, String>(2) == "5".repeat(64));
    let recipes = client
        .query(
            "SELECT recipe.id::TEXT,recipe.source_case_ids::TEXT,revocation.reason
         FROM ai_work_program_recipe AS recipe
         JOIN ai_work_program_recipe_revocation AS revocation
           ON revocation.organization_id=recipe.organization_id AND revocation.recipe_id=recipe.id
         ORDER BY recipe.organization_id",
            &[],
        )
        .await?;
    ensure!(
        recipes.len() == 2,
        "tenant-local equal recipe IDs or revocation rows were lost"
    );
    ensure!(recipes[0].get::<_, String>(0) == "18446744073709551615");
    ensure!(recipes[0].get::<_, String>(1) == "[9007199254741001, 9007199254741003]");
    ensure!(recipes[0].get::<_, String>(2) == "Source changed");
    ensure!(recipes[1].get::<_, String>(2) == "Other tenant source changed");
    Ok(())
}
