//! Transactional commit application. This is the sole transaction owner.

use anyhow::{bail, Context, Result};
use deadpool_postgres::Pool;
use std::collections::BTreeMap;
use tokio_postgres::types::ToSql;
use tokio_postgres::Statement;

use super::super::conventions::quote_identifier;
use super::super::pg_codec::PgValue;
use super::checksum::decode_identity;
use super::prepare::{validate_commit, validate_commit_cached, validate_sequence};
use super::sql::build_upsert_sql;
use super::{
    OrganizationCommitEnvelope, OrganizationRowChangeInput, PreparedChange, ProjectionMode,
    ProjectionResult, SequenceDisposition,
};

/// Apply one complete commit atomically.
///
/// `projection_codec_manifest_json` must be the generated all-table
/// projection manifest. It is data, not a caller-selected SQL destination;
/// each relation is validated and quoted before being used in SQL.
pub async fn apply_commit(
    pool: &Pool,
    projection_codec_manifest_json: &str,
    commit: &OrganizationCommitEnvelope,
    changes: &[OrganizationRowChangeInput],
) -> Result<ProjectionResult> {
    let canonical_manifest = super::super::projection_worker::PROJECTION_CODEC_MANIFEST_JSON;
    let prepared = if projection_codec_manifest_json.len() == canonical_manifest.len()
        && std::ptr::eq(
            projection_codec_manifest_json.as_ptr(),
            canonical_manifest.as_ptr(),
        ) {
        validate_commit_cached(commit, changes)?
    } else {
        validate_commit(projection_codec_manifest_json, commit, changes)?
    };

    let mut client = pool
        .get()
        .await
        .context("get PG client for commit projection")?;
    let transaction = client
        .transaction()
        .await
        .context("begin commit projection transaction")?;

    let organization_id = commit.organization_id.to_string();
    // Serialize the watermark decision across worker processes. Locking the
    // watermark row alone is insufficient for an organization's first commit,
    // because no row exists yet to lock.
    transaction
        .query_one(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            &[&organization_id],
        )
        .await
        .context("lock organization projection cursor")?;
    let watermark = transaction
        .query_opt(
            "SELECT applied_sequence::TEXT, commit_checksum \
             FROM organization_projection_watermark \
             WHERE organization_id = $1::TEXT::NUMERIC FOR UPDATE",
            &[&organization_id],
        )
        .await
        .context("lock organization projection watermark")?;
    let current_sequence = watermark
        .as_ref()
        .map(|row| row.get::<_, String>(0))
        .map(|value| value.parse::<u64>())
        .transpose()
        .context("decode organization projection watermark")?;

    match validate_sequence(current_sequence, commit.sequence)? {
        SequenceDisposition::AlreadyApplied => {
            let existing = transaction
                .query_opt(
                    "SELECT checksum FROM organization_commit WHERE id = $1",
                    &[&commit.id],
                )
                .await
                .context("read existing organization commit")?;
            if existing
                .as_ref()
                .is_some_and(|row| row.get::<_, String>(0) == commit.checksum)
            {
                transaction.rollback().await.ok();
                return Ok(ProjectionResult::AlreadyApplied);
            }
            bail!(
                "stale organization commit {} conflicts with the applied checksum",
                commit.id
            );
        }
        SequenceDisposition::Apply => {}
    }

    let actor_identity = decode_identity(&commit.actor_identity_hex)?;
    let organization_id_text = organization_id;
    let sequence_text = commit.sequence.to_string();
    let schema_version = i64::from(commit.change_schema_version);
    let row_change_count = i64::from(commit.row_change_count);
    let params: [&(dyn ToSql + Sync); 11] = [
        &commit.id,
        &organization_id_text,
        &sequence_text,
        &commit.operation_id,
        &commit.correlation_id,
        &schema_version,
        &commit.contract_version,
        &commit.occurred_at_micros,
        &actor_identity,
        &row_change_count,
        &commit.checksum,
    ];
    transaction
        .execute(
            "INSERT INTO organization_commit \
             (id, organization_id, sequence, operation_id, correlation_id, \
              change_schema_version, contract_version, occurred_at, actor_identity, \
              row_change_count, checksum) \
             VALUES ($1, $2::TEXT::NUMERIC, $3::TEXT::NUMERIC, $4, $5, $6, $7, $8, $9, $10, $11)",
            &params,
        )
        .await
        .context("insert organization commit")?;

    insert_changes(&transaction, &prepared).await?;
    let mut statements = BTreeMap::new();
    for change in &prepared {
        apply_change(&transaction, change, &mut statements).await?;
    }

    transaction
        .execute(
            "INSERT INTO organization_projection_watermark \
             (organization_id, applied_sequence, commit_id, commit_checksum) \
             VALUES ($1::TEXT::NUMERIC, $2::TEXT::NUMERIC, $3, $4) \
             ON CONFLICT (organization_id) DO UPDATE SET \
                applied_sequence = EXCLUDED.applied_sequence, \
                commit_id = EXCLUDED.commit_id, \
                commit_checksum = EXCLUDED.commit_checksum, \
                applied_at = now()",
            &[
                &organization_id_text,
                &sequence_text,
                &commit.id,
                &commit.checksum,
            ],
        )
        .await
        .context("advance organization projection watermark")?;
    transaction
        .commit()
        .await
        .context("commit organization projection transaction")?;

    Ok(ProjectionResult::Applied)
}

const JOURNAL_INSERT_CHUNK_SIZE: usize = 4_096;

pub(super) async fn insert_changes(
    transaction: &tokio_postgres::Transaction<'_>,
    changes: &[PreparedChange],
) -> Result<()> {
    for chunk in changes.chunks(JOURNAL_INSERT_CHUNK_SIZE) {
        let organization_id = chunk[0].input.organization_id.to_string();
        let sequence = chunk[0].input.commit_sequence.to_string();
        let ordinals = chunk
            .iter()
            .map(|change| i64::from(change.input.ordinal))
            .collect::<Vec<_>>();
        let rows = chunk
            .iter()
            .map(|change| change.input.row_json.as_deref())
            .collect::<Vec<_>>();
        let mut sql = String::from(
            "INSERT INTO organization_row_change \
             (id, organization_id, commit_sequence, ordinal, table_name, \
              row_identity_json, change_kind, row_json, checksum) VALUES ",
        );
        let mut params: Vec<&(dyn ToSql + Sync)> = Vec::with_capacity(2 + chunk.len() * 7);
        params.push(&organization_id);
        params.push(&sequence);
        for (index, change) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push_str(", ");
            }
            let offset = 3 + index * 7;
            use std::fmt::Write as _;
            write!(
                sql,
                "(${offset}, $1::TEXT::NUMERIC, $2::TEXT::NUMERIC, ${}, ${}, ${}::TEXT::JSONB, ${}, ${}::TEXT::JSONB, ${})",
                offset + 1,
                offset + 2,
                offset + 3,
                offset + 4,
                offset + 5,
                offset + 6,
            )
            .expect("writing SQL to String cannot fail");
            params.extend_from_slice(&[
                &change.input.id,
                &ordinals[index],
                &change.input.table_name,
                &change.input.row_identity_json,
                &change.input.change_kind,
                &rows[index],
                &change.input.checksum,
            ]);
        }
        let inserted = transaction
            .execute(&sql, &params)
            .await
            .context("insert organization row-change batch")?;
        if inserted != chunk.len() as u64 {
            bail!("organization row-change batch did not insert every ordered change");
        }
    }
    Ok(())
}

async fn apply_change(
    transaction: &tokio_postgres::Transaction<'_>,
    change: &PreparedChange,
    statements: &mut BTreeMap<String, Statement>,
) -> Result<()> {
    match change.input.change_kind.as_str() {
        "upsert" => {
            let sql = build_upsert_sql(&change.codec, change.values.len())?;
            let organization_id = change.input.organization_id.to_string();
            let mut params: Vec<&(dyn ToSql + Sync)> =
                change.values.iter().map(PgValue::as_sql).collect();
            if change.codec.projection_mode == ProjectionMode::UpsertCurrent
                && change
                    .codec
                    .columns
                    .iter()
                    .any(|column| column.name != change.codec.primary_key)
            {
                params.push(&organization_id);
            }
            let statement = prepared_statement(transaction, statements, &sql).await?;
            let affected = transaction
                .execute(&statement, &params)
                .await
                .with_context(|| format!("apply upsert to {}", change.codec.table_name))?;
            if affected != 1 {
                bail!(
                    "upsert to {} did not affect exactly one organization-owned row",
                    change.codec.table_name
                );
            }
        }
        "delete" => {
            let table = quote_identifier(&change.codec.table_name)?;
            let primary_key = quote_identifier(&change.codec.primary_key)?;
            let placeholder = change
                .key_value
                .needs_cast()
                .map_or_else(|| "$1".to_string(), |cast| format!("$1::{cast}"));
            let organization_id = change.input.organization_id.to_string();
            let sql = format!(
                "DELETE FROM {table} WHERE {primary_key} = {placeholder} \
                 AND \"organization_id\" = $2::TEXT::NUMERIC"
            );
            let params: [&(dyn ToSql + Sync); 2] = [change.key_value.as_sql(), &organization_id];
            let statement = prepared_statement(transaction, statements, &sql).await?;
            transaction
                .execute(&statement, &params)
                .await
                .with_context(|| format!("apply delete to {}", change.codec.table_name))?;
        }
        kind => bail!("unsupported organization row change kind '{kind}'"),
    }
    Ok(())
}

async fn prepared_statement(
    transaction: &tokio_postgres::Transaction<'_>,
    statements: &mut BTreeMap<String, Statement>,
    sql: &str,
) -> Result<Statement> {
    if let Some(statement) = statements.get(sql) {
        return Ok(statement.clone());
    }
    let statement = transaction
        .prepare(sql)
        .await
        .context("prepare projection row mutation")?;
    statements.insert(sql.to_owned(), statement.clone());
    Ok(statement)
}
