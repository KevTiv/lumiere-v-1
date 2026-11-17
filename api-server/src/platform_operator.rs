//! Private, single-purpose enrollment and canonical projection. Never starts HTTP
//! services, provisions identities, changes roles, or contacts a model provider.

use anyhow::{bail, ensure, Context, Result};
use deadpool_postgres::Pool;
use lumiere_policy_core::{
    persistent_operator_source_lease_valid, PersistentPlatformOperatorPolicy,
    PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY,
};
use serde_json::{json, Value};
use stdb_client::{ReducerCall, StdbClient};

use crate::cold_tier::pg_pool::{build_pool, PgConfig};

const KEY: &str = PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY;
const RPC: &str = "enroll_persistent_platform_operator";
const AUTH_PROFILE_BOOKKEEPING: &[&str] = &["updated_at", "last_login"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Plan,
    Check,
    Apply,
}

impl Mode {
    pub(crate) fn parse(args: &[String]) -> Result<Self> {
        ensure!(
            args.len() == 2 && args[0] == "platform-operator",
            "usage: api-server [platform-operator --plan|--check|--apply]"
        );
        match args[1].as_str() {
            "--plan" => Ok(Self::Plan),
            "--check" => Ok(Self::Check),
            "--apply" => Ok(Self::Apply),
            _ => bail!("usage: api-server platform-operator --plan|--check|--apply"),
        }
    }
}

fn env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .with_context(|| format!("{name} is required"))
}

fn private_client(host: String, module: String, token: String) -> Result<StdbClient> {
    let url = reqwest::Url::parse(&host).context("invalid private SpacetimeDB origin")?;
    let hostname = url.host_str().context("missing private database host")?;
    ensure!(
        url.scheme() == "http"
            && (hostname.ends_with(".railway.internal")
                || ["localhost", "127.0.0.1", "[::1]", "::1"].contains(&hostname))
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "operator enrollment requires a private or loopback SpacetimeDB origin"
    );
    ensure!(
        !module.is_empty()
            && module.len() <= 128
            && module
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)),
        "invalid SpacetimeDB module name"
    );
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .context("construct private operator transport")?;
    Ok(StdbClient::new(host, module, token).with_http_client(http))
}

pub(crate) async fn run(mode: Mode) -> Result<()> {
    let policy =
        PersistentPlatformOperatorPolicy::parse(&env("LUMIERE_PERSISTENT_PLATFORM_OPERATOR")?)
            .map_err(|_| anyhow::anyhow!("invalid persistent operator policy"))?;
    let stdb = private_client(
        env("STDB_HOST")?,
        env("STDB_MODULE")?,
        env("STDB_SERVER_TOKEN")?,
    )?;
    let pool = build_pool(&PgConfig::from_env()?)?;
    // Deliberately discard transport/database error details: upstream bodies and
    // SQL diagnostics are not an approved operator output channel.
    match execute(mode, &policy, &stdb, &pool).await {
        Ok(report) => {
            println!("{}", serde_json::to_string_pretty(&report)?);
            Ok(())
        }
        Err(_) => bail!("operator verification incomplete; stopped without retry. Inspect both stores with --plan/--check before resuming --apply; native enrollment may already be durable"),
    }
}

fn field<'a>(row: &'a Value, name: &str) -> Result<&'a Value> {
    row.get(name).with_context(|| format!("missing {name}"))
}

fn number(row: &Value, name: &str) -> Result<u64> {
    let v = field(row, name)?;
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .with_context(|| format!("invalid {name}"))
}

fn text<'a>(row: &'a Value, name: &str) -> Result<&'a str> {
    field(row, name)?
        .as_str()
        .with_context(|| format!("invalid {name}"))
}

fn flag(row: &Value, name: &str) -> Result<bool> {
    field(row, name)?
        .as_bool()
        .with_context(|| format!("invalid {name}"))
}

fn identity_matches(row: &Value, name: &str, expected: &str) -> bool {
    row.get(name)
        .and_then(|v| v.as_str().or_else(|| v.get("__identity__")?.as_str()))
        .and_then(stdb_client::normalize_spacetime_identity_header)
        .is_some_and(|identity| identity == expected)
}

fn option(v: &Value) -> Option<&Value> {
    if v.is_null() || v.get("none").is_some() {
        None
    } else {
        Some(v.get("some").unwrap_or(v))
    }
}

fn metadata(row: &Value) -> Result<String> {
    option(field(row, "metadata")?)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .context("missing operator metadata")
}

fn lease(raw: &str) -> Result<()> {
    ensure!(
        persistent_operator_source_lease_valid(raw, chrono::Utc::now().timestamp_micros()),
        "invalid bootstrap lease"
    );
    Ok(())
}

fn persistent(raw: &str, policy: &PersistentPlatformOperatorPolicy) -> Result<Value> {
    let value: Value = serde_json::from_str(raw)?;
    let entry = value.get(KEY).context("missing persistent metadata")?;
    ensure!(
        text(entry, "identityHex")? == policy.identity_hex
            && number(entry, "organizationId")? == policy.organization_id
            && number(entry, "companyId")? == policy.company_id
            && text(entry, "approvalRef")? == policy.approval_ref,
        "persistent policy mismatch"
    );
    lease(text(entry, "sourceBootstrapLease")?)?;
    ensure!(
        number(entry, "enrolledAtMicros")? > 0,
        "invalid enrollment timestamp"
    );
    Ok(value)
}

fn singleton(mut rows: Vec<Value>) -> Result<Value> {
    ensure!(rows.len() == 1, "expected exactly one row");
    Ok(rows.remove(0))
}

async fn rows(stdb: &StdbClient, sql: &str) -> Result<Vec<Value>> {
    stdb.with_query_limits(1000, 2 * 1024 * 1024)?
        .query_sql_sats(sql)
        .await
}

async fn probe(stdb: &StdbClient, apply: bool) -> Result<()> {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        stdb.call_reducer(ReducerCall::from_name(RPC, json!([apply]))?),
    )
    .await
    .context("native enrollment result uncertain; do not retry")?
}

#[derive(Clone)]
struct Native {
    profile: Value,
    membership: Value,
    role: Value,
    audits: Vec<Value>,
    permanent: bool,
    origin: String,
}

impl Native {
    fn platform_id(&self) -> Result<&str> {
        text(&self.profile, "platform_user_id")
    }
}

async fn inspect_native(stdb: &StdbClient, p: &PersistentPlatformOperatorPolicy) -> Result<Native> {
    let identity = &p.identity_hex;
    let profile = singleton(
        rows(
            stdb,
            &format!("SELECT * FROM user_profile WHERE identity = 0x{identity}"),
        )
        .await?,
    )?;
    ensure!(
        number(&profile, "organization_id")? == p.organization_id
            && identity_matches(&profile, "identity", identity),
        "unexpected profile scope"
    );
    let membership = singleton(
        rows(
            stdb,
            &format!("SELECT * FROM user_organization WHERE user_identity = 0x{identity}"),
        )
        .await?,
    )?;
    ensure!(
        number(&membership, "organization_id")? == p.organization_id
            && identity_matches(&membership, "user_identity", identity)
            && option(field(&membership, "company_id")?).and_then(Value::as_u64)
                == Some(p.company_id)
            && flag(&membership, "is_default")?,
        "unexpected membership scope"
    );
    let platform_id = text(&profile, "platform_user_id")?;
    ensure!(
        !platform_id.is_empty()
            && platform_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
        "invalid opaque platform binding"
    );
    ensure!(
        rows(
            stdb,
            &format!("SELECT id FROM user_profile WHERE platform_user_id = '{platform_id}'")
        )
        .await?
        .len()
            == 1,
        "duplicate opaque profile binding"
    );
    ensure!(
        rows(
            stdb,
            &format!("SELECT id FROM user_credential WHERE identity = 0x{identity}")
        )
        .await?
        .is_empty(),
        "native human credential present"
    );
    ensure!(
        rows(
            stdb,
            &format!("SELECT id FROM user_credential WHERE platform_user_id = '{platform_id}'")
        )
        .await?
        .is_empty(),
        "native credential binding present"
    );
    let role_id = number(&membership, "role_id")?;
    let role = singleton(rows(stdb, &format!("SELECT * FROM role WHERE id = {role_id}")).await?)?;
    ensure!(
        number(&role, "organization_id")? == p.organization_id
            && flag(&role, "is_active")?
            && option(field(&role, "parent_id")?).is_none()
            && field(&role, "permissions")?
                .as_array()
                .is_some_and(Vec::is_empty),
        "role must be active, empty and non-inherited"
    );
    let role_members = rows(
        stdb,
        &format!("SELECT id FROM user_organization WHERE role_id = {role_id} AND is_active = true"),
    )
    .await?;
    ensure!(
        role_members.len() <= 1
            && role_members
                .iter()
                .all(|row| number(row, "id").ok() == number(&membership, "id").ok()),
        "role must have no other active member"
    );
    for table in ["org_permission", "field_permission"] {
        // role_id is Option<u64>; native SQL cannot apply scalar operators to
        // sum values. Bound by the scalar organization column, then inspect the
        // canonical Option locally instead of inventing nullable SQL syntax.
        let grants = rows(
            stdb,
            &format!(
                "SELECT role_id FROM {table} WHERE organization_id = {}",
                p.organization_id
            ),
        )
        .await?;
        for grant in grants {
            ensure!(
                option(field(&grant, "role_id")?)
                    .is_none_or(|v| v.as_u64().is_some_and(|id| id != role_id)),
                "role has grants or malformed permission binding"
            );
        }
    }
    let raw = metadata(&profile)?;
    ensure!(raw == metadata(&membership)?, "operator metadata differs");
    let (permanent, origin) = if raw.trim().starts_with('{') {
        let value = persistent(&raw, p)?;
        ensure!(
            flag(&profile, "is_active")?
                && flag(&profile, "is_superuser")?
                && flag(&membership, "is_active")?,
            "persistent operator revoked; never reactivate"
        );
        (true, text(&value[KEY], "sourceBootstrapLease")?.to_owned())
    } else {
        lease(&raw)?;
        ensure!(
            !flag(&profile, "is_superuser")?
                && !flag(&profile, "is_active")?
                && !flag(&membership, "is_active")?,
            "expected exact inactive, non-superuser bootstrap starting state"
        );
        (false, raw)
    };
    let mut audits = rows(stdb, &format!(
        "SELECT * FROM audit_log WHERE organization_id = {} AND user_identity = 0x{identity} AND action = 'persistent_platform_operator_enrollment'",
        p.organization_id)).await?;
    audits.sort_by_key(|row| number(row, "id").unwrap_or(u64::MAX));
    for audit in &audits {
        number(audit, "id")?;
    }
    let native = Native {
        profile,
        membership,
        role,
        audits,
        permanent,
        origin,
    };
    if native.permanent {
        let mut baseline = native.clone();
        baseline.audits.clear();
        verify_enrollment_audits(&baseline, &native, p)?;
    }
    Ok(native)
}

fn stable_delta(before: &Value, after: &Value, allowed: &[&str]) -> Result<()> {
    let mut before = before.clone();
    let mut after = after.clone();
    for value in [&mut before, &mut after] {
        let object = value.as_object_mut().context("row must be object")?;
        for key in allowed {
            object.remove(*key);
        }
    }
    ensure!(before == after, "unrelated row fields changed");
    Ok(())
}

async fn canonical(
    pool: &Pool,
    native: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<Value> {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let mut client = pool.get().await?;
        let tx = client.build_transaction().read_only(true).start().await?;
        tx.batch_execute("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'")
            .await?;
        let row = tx.query_one(
            "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id=$1 AND stdb_identity_hex=$2",
            &[&native.platform_id()?, &p.identity_hex]).await?;
        let value: Value = row.get(0);
        let count: i64 = tx.query_one(
            "SELECT count(*) FROM lumiere_platform.user_credential WHERE platform_user_id=$1 OR stdb_identity_hex=$2",
            &[&native.platform_id()?, &p.identity_hex]).await?.get(0);
        ensure!(count == 0, "canonical human credential present");
        validate_canonical(&value, native, p)?;
        tx.commit().await?;
        Ok(value)
    })
    .await
    .context("canonical operator inspection timed out")?
}

fn validate_canonical(
    value: &Value,
    native: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<()> {
    ensure!(
        text(value, "platform_user_id")? == native.platform_id()?
            && text(value, "stdb_identity_hex")? == p.identity_hex,
        "opaque binding mismatch"
    );
    let meta = field(value, "metadata")?;
    if let Some(raw) = meta.as_str() {
        ensure!(raw == native.origin, "canonical bootstrap origin differs");
        lease(raw)?;
        ensure!(
            !flag(value, "is_superuser")?,
            "unexpected canonical bootstrap root"
        );
    } else {
        persistent(&meta.to_string(), p)?;
        ensure!(
            flag(value, "is_active")? && flag(value, "is_superuser")?,
            "canonical persistent operator revoked; never reactivate"
        );
        ensure!(
            native.permanent
                && *meta == serde_json::from_str::<Value>(&metadata(&native.profile)?)?,
            "canonical persistent metadata differs"
        );
    }
    Ok(())
}

fn ready(pg: &Value, native: &Native) -> Result<bool> {
    Ok(native.permanent
        && flag(pg, "is_active")?
        && flag(pg, "is_superuser")?
        && pg["metadata"] == serde_json::from_str::<Value>(&metadata(&native.profile)?)?)
}

async fn enroll_native(
    stdb: &StdbClient,
    before: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<Native> {
    ensure!(!before.permanent, "cannot reenroll permanent operator");
    // Native performs reactivation and enrollment in ONE transaction. SQL
    // cannot compare Option metadata safely; split scalar writes could revive a
    // concurrently revoked persistent row. Never issue native SQL DML here.
    probe(stdb, true).await?;
    let after = inspect_native(stdb, p).await?;
    stable_delta(
        &before.profile,
        &after.profile,
        &[
            "is_active",
            "is_superuser",
            "metadata",
            "updated_at",
            "last_login",
        ],
    )?;
    stable_delta(
        &before.membership,
        &after.membership,
        &["is_active", "metadata"],
    )?;
    ensure!(
        after.permanent
            && after.origin == before.origin
            && before.role == after.role
            && flag(&after.profile, "is_active")?
            && flag(&after.membership, "is_active")?,
        "atomic enrollment readback mismatch"
    );
    verify_enrollment_audits(before, &after, p)?;
    Ok(after)
}

async fn project(
    pool: &Pool,
    expected: &Value,
    native: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<()> {
    ensure!(native.permanent, "native enrollment required");
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    tx.batch_execute("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'")
        .await?;
    // Prevent a concurrent credential insertion between the zero-count check
    // and commit. No credential contents are selected.
    tx.batch_execute("LOCK TABLE lumiere_platform.user_credential IN SHARE MODE")
        .await?;
    let locked: Value = tx.query_one(
        "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id=$1 AND stdb_identity_hex=$2 FOR UPDATE",
        &[&native.platform_id()?, &p.identity_hex]).await?.get(0);
    ensure!(
        &locked == expected,
        "canonical row changed since inspection"
    );
    let count: i64 = tx.query_one(
        "SELECT count(*) FROM lumiere_platform.user_credential WHERE platform_user_id=$1 OR stdb_identity_hex=$2",
        &[&native.platform_id()?, &p.identity_hex]).await?.get(0);
    ensure!(count == 0, "canonical credential appeared");
    validate_canonical(&locked, native, p)?;
    let meta: Value = serde_json::from_str(&metadata(&native.profile)?)?;
    let count = tx.execute(
        "UPDATE lumiere_platform.user_profile SET is_active=true,is_superuser=true,metadata=$3 WHERE platform_user_id=$1 AND stdb_identity_hex=$2 AND to_jsonb(user_profile)=$4",
        &[&native.platform_id()?, &p.identity_hex, &meta, &locked]).await?;
    ensure!(count == 1, "projection compare-and-set failed");
    let readback: Value = tx.query_one(
        "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id=$1 AND stdb_identity_hex=$2",
        &[&native.platform_id()?, &p.identity_hex]).await?.get(0);
    stable_delta(
        &locked,
        &readback,
        &["is_active", "is_superuser", "metadata"],
    )?;
    ensure!(ready(&readback, native)?, "projection readback incomplete");
    tx.commit().await?;
    Ok(())
}

async fn authorized_snapshot(
    stdb: &StdbClient,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<Native> {
    ensure!(
        stdb.authenticated_identity().await? == p.identity_hex,
        "token identity mismatch"
    );
    let before = inspect_native(stdb, p).await?;
    // The env policy is a selector, NOT authority. The compiled native policy
    // must authorize this exact sender and scope before any DML or projection.
    probe(stdb, false).await?;
    let probed = inspect_native(stdb, p).await?;
    // HTTP reducer authentication may run the existing identity-connected
    // lifecycle hook. Those two server-owned fields are not enrollment effects.
    stable_delta(&before.profile, &probed.profile, AUTH_PROFILE_BOOKKEEPING)?;
    ensure!(
        before.membership == probed.membership
            && before.role == probed.role
            && before.audits == probed.audits,
        "probe changed enrollment state"
    );
    Ok(probed)
}

/// A successful raw read can confirm revoked/deleted/rebound authority. A
/// transport/decode failure cannot: propagate it without compensating.
async fn native_authority_matches(stdb: &StdbClient, expected: &Native) -> Result<bool> {
    ensure!(expected.permanent, "expected enrolled native authority");
    for (table, expected_row, keys) in [
        (
            "user_profile",
            &expected.profile,
            &[
                "id",
                "identity",
                "platform_user_id",
                "organization_id",
                "is_active",
                "is_superuser",
                "metadata",
            ][..],
        ),
        (
            "user_organization",
            &expected.membership,
            &[
                "id",
                "user_identity",
                "organization_id",
                "company_id",
                "role_id",
                "is_default",
                "is_active",
                "metadata",
            ][..],
        ),
    ] {
        let actual = rows(
            stdb,
            &format!(
                "SELECT * FROM {table} WHERE id = {}",
                number(expected_row, "id")?
            ),
        )
        .await?;
        if actual.len() != 1
            || keys
                .iter()
                .any(|key| actual[0].get(*key) != expected_row.get(*key))
        {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Downward-only repair of THIS projection. This is not a cross-store fence:
/// interactive auth independently rejects the persistent nonhuman marker.
async fn compensate_projection(
    pool: &Pool,
    expected: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<bool> {
    ensure!(expected.permanent, "expected enrolled native authority");
    let meta: Value = serde_json::from_str(&metadata(&expected.profile)?)?;
    let mut client = pool.get().await?;
    let tx = client.transaction().await?;
    tx.batch_execute("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s'")
        .await?;
    let locked = tx.query_opt(
        "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id=$1 AND stdb_identity_hex=$2 FOR UPDATE",
        &[&expected.platform_id()?, &p.identity_hex],
    ).await?;
    let Some(locked) = locked else {
        tx.commit().await?;
        return Ok(false);
    };
    let before: Value = locked.get(0);
    if before["metadata"] != meta {
        tx.commit().await?;
        return Ok(false);
    }
    let changed = tx.execute(
        "UPDATE lumiere_platform.user_profile SET is_active=false,is_superuser=false WHERE platform_user_id=$1 AND stdb_identity_hex=$2 AND metadata=$3",
        &[&expected.platform_id()?, &p.identity_hex, &meta],
    ).await?;
    ensure!(changed == 1, "downward compensation guard changed");
    let after: Value = tx.query_one(
        "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id=$1 AND stdb_identity_hex=$2",
        &[&expected.platform_id()?, &p.identity_hex],
    ).await?.get(0);
    stable_delta(&before, &after, &["is_active", "is_superuser"])?;
    ensure!(
        !flag(&after, "is_active")? && !flag(&after, "is_superuser")?,
        "downward compensation incomplete"
    );
    tx.commit().await?;
    Ok(true)
}

async fn confirm_native_or_compensate(
    stdb: &StdbClient,
    pool: &Pool,
    expected: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<()> {
    if !native_authority_matches(stdb, expected).await? {
        compensate_projection(pool, expected, p).await?;
        bail!("native authority changed; guarded downward projection repair attempted; no regrant");
    }
    Ok(())
}

async fn execute(
    mode: Mode,
    p: &PersistentPlatformOperatorPolicy,
    stdb: &StdbClient,
    pool: &Pool,
) -> Result<Value> {
    let before = authorized_snapshot(stdb, p).await?;
    let pg = canonical(pool, &before, p).await?;
    let complete = ready(&pg, &before)?;
    if mode == Mode::Check {
        ensure!(complete, "operator projection incomplete");
    }
    if mode != Mode::Apply || complete {
        return Ok(report(p, &before, complete, false));
    }
    let native = if before.permanent {
        before.clone()
    } else {
        enroll_native(stdb, &before, p).await?
    };
    // Failure here is resumable projection, never re-enrollment/rollback.
    if let Err(error) = project(pool, &pg, &native, p).await {
        // A failed commit acknowledgement may still have persisted projection.
        // Only confirmed lost native authority permits downward compensation.
        confirm_native_or_compensate(stdb, pool, &native, p).await?;
        return Err(error);
    }
    confirm_native_or_compensate(stdb, pool, &native, p).await?;
    let final_native = match inspect_native(stdb, p).await {
        Ok(value) => value,
        Err(error) => {
            // Strict inspection may reject a concurrent revocation. Confirm it
            // with successful raw reads before any downward repair; an outage
            // alone is not evidence that the native operator was revoked.
            confirm_native_or_compensate(stdb, pool, &native, p).await?;
            return Err(error);
        }
    };
    let final_pg = canonical(pool, &final_native, p).await?;
    confirm_native_or_compensate(stdb, pool, &native, p).await?;
    stable_delta(
        &native.profile,
        &final_native.profile,
        AUTH_PROFILE_BOOKKEEPING,
    )?;
    ensure!(
        native.membership == final_native.membership
            && native.role == final_native.role
            && native.audits == final_native.audits
            && ready(&final_pg, &final_native)?,
        "fresh verification incomplete"
    );
    stable_delta(&pg, &final_pg, &["is_active", "is_superuser", "metadata"])?;
    Ok(report(p, &final_native, true, true))
}

fn verify_enrollment_audits(
    before: &Native,
    after: &Native,
    p: &PersistentPlatformOperatorPolicy,
) -> Result<()> {
    ensure!(
        before.audits.iter().all(|row| after.audits.contains(row)),
        "existing audit changed"
    );
    let added = after
        .audits
        .iter()
        .filter(|row| !before.audits.contains(row))
        .collect::<Vec<_>>();
    ensure!(added.len() == 2, "expected two native enrollment audits");
    for (table, row) in [
        ("user_profile", &after.profile),
        ("user_organization", &after.membership),
    ] {
        let entries = added
            .iter()
            .filter(|audit| {
                text(audit, "table_name").ok() == Some(table)
                    && number(audit, "record_id").ok() == number(row, "id").ok()
            })
            .collect::<Vec<_>>();
        ensure!(entries.len() == 1, "missing exact enrollment audit");
        let audit = entries[0];
        ensure!(
            number(audit, "organization_id")? == p.organization_id
                && identity_matches(audit, "user_identity", &p.identity_hex)
                && option(field(audit, "company_id")?).and_then(Value::as_u64)
                    == Some(p.company_id)
                && metadata(audit)? == metadata(&after.profile)?
                && text(audit, "action")? == "persistent_platform_operator_enrollment",
            "invalid enrollment audit binding"
        );
    }
    Ok(())
}

fn report(
    p: &PersistentPlatformOperatorPolicy,
    native: &Native,
    coherent: bool,
    changed: bool,
) -> Value {
    json!({
        "identityHex": p.identity_hex,
        "organizationId": p.organization_id,
        "companyId": p.company_id,
        "approvalRef": p.approval_ref,
        "profileId": native.profile["id"],
        "membershipId": native.membership["id"],
        "platformUserId": native.profile["platform_user_id"],
        "nativeProfileActive": native.profile["is_active"],
        "nativeMembershipActive": native.membership["is_active"],
        "nativeEnrolled": native.permanent,
        "interactiveSessionsAllowed": false,
        "canonicalCoherent": coherent,
        "nextStep": if coherent { "none" } else if native.permanent {
            "resume canonical projection with --apply"
        } else { "atomically reactivate and enroll exact bootstrap rows natively, then project with --apply" },
        "changed": changed,
        "billableCalls": 0,
        "scope": "existing non-human operator only; no production readiness claim"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operator_transport_rejects_public_origins_and_embedded_authority() {
        crate::install_rustls_crypto_provider();
        for host in [
            "https://public.example",
            "http://private.railway.internal.attacker.example",
            "http://user:password@private.railway.internal",
            "http://private.railway.internal/path",
            "http://private.railway.internal/?redirect=elsewhere",
            "http://private.railway.internal/#fragment",
        ] {
            assert!(
                private_client(host.into(), "module".into(), "synthetic-local-token".into())
                    .is_err()
            );
        }
        for host in [
            "http://private.railway.internal:3000",
            "http://127.0.0.1:3000",
        ] {
            assert!(
                private_client(host.into(), "module".into(), "synthetic-local-token".into())
                    .is_ok()
            );
        }
        assert!(private_client(
            "http://localhost:3000".into(),
            "module/other".into(),
            "synthetic-local-token".into(),
        )
        .is_err());
    }

    #[tokio::test]
    async fn operator_transport_never_follows_an_authenticated_redirect() {
        crate::install_rustls_crypto_provider();
        use axum::{routing::post, Router};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let downstream = Arc::new(AtomicUsize::new(0));
        let observed = downstream.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination = listener.local_addr().unwrap();
        let target = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/elsewhere",
                    post(move || {
                        let observed = observed.clone();
                        async move {
                            observed.fetch_add(1, Ordering::SeqCst);
                            "unexpected"
                        }
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source = listener.local_addr().unwrap();
        let origin = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route(
                    "/v1/database/module/sql",
                    post(move || async move {
                        axum::response::Redirect::temporary(&format!(
                            "http://{destination}/elsewhere"
                        ))
                    }),
                ),
            )
            .await
            .unwrap();
        });
        let client = private_client(
            format!("http://{source}"),
            "module".into(),
            "synthetic-local-token".into(),
        )
        .unwrap();
        assert!(client.authenticated_identity().await.is_err());
        assert_eq!(downstream.load(Ordering::SeqCst), 0);
        origin.abort();
        target.abort();
    }

    #[test]
    fn modes_are_exact_and_accept_no_target_or_token_arguments() {
        for mode in ["--plan", "--check", "--apply"] {
            assert!(Mode::parse(&["platform-operator".into(), mode.into()]).is_ok());
        }
        for args in [
            vec![],
            vec!["--apply"],
            vec!["platform-operator", "--unknown"],
            vec!["platform-operator", "--apply", "target"],
        ] {
            assert!(Mode::parse(&args.into_iter().map(str::to_owned).collect::<Vec<_>>()).is_err());
        }
    }

    #[test]
    fn expired_bootstrap_origin_remains_valid_but_malformed_never_does() {
        assert!(lease("lumiere-platform-bootstrap-v1:1:2").is_ok());
        for raw in [
            "{}",
            "lumiere-platform-bootstrap-v1:2:1",
            "lumiere-platform-bootstrap-v1:0:3600000001",
            "lumiere-platform-bootstrap-v1:-1:2",
        ] {
            assert!(lease(raw).is_err());
        }
    }

    #[test]
    fn unrelated_field_mutations_are_not_hidden_by_authorized_delta() {
        let before = json!({"is_active":false,"name":"operator","metadata":"lease"});
        let after = json!({"is_active":true,"name":"operator","metadata":"lease"});
        assert!(stable_delta(&before, &after, &["is_active"]).is_ok());
        let changed = json!({"is_active":true,"name":"human","metadata":"lease"});
        assert!(stable_delta(&before, &changed, &["is_active"]).is_err());
    }

    #[test]
    fn authentication_bookkeeping_never_hides_authority_or_settings_changes() {
        let before = json!({"is_active":true,"is_superuser":true,"metadata":"receipt","name":"operator","last_login":1,"updated_at":1});
        let mut authenticated = before.clone();
        authenticated["last_login"] = json!(2);
        authenticated["updated_at"] = json!(2);
        assert!(stable_delta(&before, &authenticated, AUTH_PROFILE_BOOKKEEPING).is_ok());
        for (key, changed) in [
            ("is_active", json!(false)),
            ("is_superuser", json!(false)),
            ("metadata", json!("different approval")),
            ("name", json!("another account")),
        ] {
            let mut changed_profile = authenticated.clone();
            changed_profile[key] = changed;
            assert!(stable_delta(&before, &changed_profile, AUTH_PROFILE_BOOKKEEPING).is_err());
        }
    }

    fn policy() -> PersistentPlatformOperatorPolicy {
        PersistentPlatformOperatorPolicy::parse(&format!("{}:7:9:approval-test", "ab".repeat(32)))
            .unwrap()
    }

    fn native_fixture(permanent: bool) -> Native {
        let p = policy();
        let origin = "lumiere-platform-bootstrap-v1:1:2".to_owned();
        let meta = if permanent {
            json!({KEY:{
                "identityHex":p.identity_hex,"organizationId":7,"companyId":9,
                "approvalRef":p.approval_ref,"sourceBootstrapLease":origin,"enrolledAtMicros":3
            }})
            .to_string()
        } else {
            origin.clone()
        };
        let mut native = Native {
            profile: json!({"id":17,"identity":{"__identity__":format!("0x{}",p.identity_hex)},
                "organization_id":7,"platform_user_id":"p_test_operator","name":"untouched",
                "is_active":permanent,"is_superuser":permanent,"metadata":{"some":meta}}),
            membership: json!({"id":18,"user_identity":{"__identity__":format!("0x{}",p.identity_hex)},
                "organization_id":7,"company_id":{"some":9},"role_id":19,
                "is_active":permanent,"is_default":true,"metadata":{"some":meta}}),
            role: json!({"id":19,"organization_id":7,"is_active":true,
                "parent_id":{"none":[]},"permissions":[],"name":"dedicated"}),
            audits: vec![],
            permanent,
            origin,
        };
        if permanent {
            native.audits = [("user_profile", 17), ("user_organization", 18)]
                .into_iter()
                .enumerate()
                .map(|(index, (table, id))| {
                    json!({
                        "id":index+101,"table_name":table,"record_id":id,
                        "organization_id":7,"company_id":{"some":9},
                        "user_identity":{"__identity__":format!("0x{}",p.identity_hex)},
                        "action":"persistent_platform_operator_enrollment",
                        "metadata":{"some":metadata(&native.profile).unwrap()}
                    })
                })
                .collect();
        }
        native
    }

    fn canonical_fixture(native: &Native, permanent: bool) -> Value {
        json!({"platform_user_id":"p_test_operator","stdb_identity_hex":policy().identity_hex,
            "is_active":permanent,"is_superuser":permanent,
            "metadata":if permanent { serde_json::from_str::<Value>(&metadata(&native.profile).unwrap()).unwrap() }
                else { json!(native.origin) }})
    }

    #[test]
    fn canonical_projection_accepts_only_exact_origin_or_active_matching_enrollment() {
        let n = native_fixture(true);
        let p = policy();
        let leased = canonical_fixture(&n, false);
        assert!(validate_canonical(&leased, &n, &p).is_ok());
        assert!(!ready(&leased, &n).unwrap());
        let enrolled = canonical_fixture(&n, true);
        assert!(validate_canonical(&enrolled, &n, &p).is_ok());
        assert!(ready(&enrolled, &n).unwrap());
        for key in ["is_active", "is_superuser"] {
            let mut revoked = enrolled.clone();
            revoked[key] = json!(false);
            assert!(validate_canonical(&revoked, &n, &p).is_err());
        }
        for (key, wrong) in [
            ("platform_user_id", json!("p_human")),
            ("stdb_identity_hex", json!("cd".repeat(32))),
            ("metadata", json!("lumiere-platform-bootstrap-v1:2:3")),
        ] {
            let mut changed = leased.clone();
            changed[key] = wrong;
            assert!(validate_canonical(&changed, &n, &p).is_err());
        }
        let mut wrong_policy = p;
        wrong_policy.company_id = 10;
        assert!(validate_canonical(&enrolled, &n, &wrong_policy).is_err());
    }

    struct Mock {
        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        client: StdbClient,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for Mock {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    #[derive(Clone)]
    struct MockState {
        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
        native: Native,
        deny_probe: bool,
        uncertain_enrollment: bool,
    }

    // Produce real SATS product/sum wire values, including Option and Identity,
    // so these tests exercise the actual HTTP client and canonical decoder.
    fn wire(value: &Value) -> (Value, Value) {
        match value {
            Value::Object(object) if object.contains_key("some") || object.contains_key("none") => {
                let (kind, cell) = object
                    .get("some")
                    .map(wire)
                    .unwrap_or((json!({"String":[]}), json!([])));
                let tag = if object.contains_key("some") { 0 } else { 1 };
                (
                    json!({"Sum":{"variants":[
                        {"name":{"some":"some"},"algebraic_type":kind},
                        {"name":{"some":"none"},"algebraic_type":{"Product":{"elements":[]}}}
                    ]}}),
                    json!([tag, cell]),
                )
            }
            Value::Object(object) => {
                let mut elements = vec![];
                let mut cells = vec![];
                for (name, v) in object {
                    let (kind, cell) = wire(v);
                    elements.push(json!({"name":{"some":name},"algebraic_type":
                        if name == "__identity__" { json!({"U256":[]}) } else { kind }}));
                    cells.push(cell);
                }
                (json!({"Product":{"elements":elements}}), json!(cells))
            }
            Value::Array(values) => {
                let kind = values
                    .first()
                    .map(wire)
                    .map(|pair| pair.0)
                    .unwrap_or(json!({"String":[]}));
                (
                    json!({"Array":kind}),
                    json!(values.iter().map(|v| wire(v).1).collect::<Vec<_>>()),
                )
            }
            Value::Bool(_) => (json!({"Bool":[]}), value.clone()),
            Value::Number(_) => (json!({"U64":[]}), value.clone()),
            _ => (json!({"String":[]}), value.clone()),
        }
    }

    fn sats(values: Vec<Value>) -> String {
        if values.is_empty() {
            return json!([{"schema":{"elements":[]},"rows":[]}]).to_string();
        }
        let (kind, _) = wire(&values[0]);
        json!([{"schema":kind["Product"],"rows":values.iter().map(|v| wire(v).1).collect::<Vec<_>>()}]).to_string()
    }

    async fn mock(native: Native, deny_probe: bool, uncertain_enrollment: bool) -> Mock {
        use axum::{
            extract::{Path, State},
            http::StatusCode,
            response::IntoResponse,
            routing::post,
            Router,
        };
        async fn sql(State(state): State<MockState>, body: String) -> axum::response::Response {
            state.requests.lock().unwrap().push(body.clone());
            assert!(body.starts_with("SELECT "), "native SQL must be read-only");
            let values = if body.starts_with("SELECT id FROM organization ") {
                vec![json!({"id":7})]
            } else if body.contains("FROM user_credential ") {
                vec![]
            } else if body.contains("SELECT id FROM user_profile ") {
                vec![json!({"id":17})]
            } else if body.contains("SELECT id FROM user_organization ") {
                if state.native.membership["is_active"] == true {
                    vec![json!({"id":18})]
                } else {
                    vec![]
                }
            } else if body.contains("FROM user_profile ") {
                vec![state.native.profile.clone()]
            } else if body.contains("FROM user_organization ") {
                vec![state.native.membership.clone()]
            } else if body.contains("FROM role ") {
                vec![state.native.role.clone()]
            } else if body.contains("FROM audit_log ") {
                state.native.audits.clone()
            } else {
                vec![]
            };
            (
                [("spacetime-identity", policy().identity_hex)],
                sats(values),
            )
                .into_response()
        }
        async fn call(
            State(state): State<MockState>,
            Path(name): Path<String>,
            body: String,
        ) -> axum::response::Response {
            state
                .requests
                .lock()
                .unwrap()
                .push(format!("CALL {name} {body}"));
            assert_eq!(name, RPC, "no generic provisioning reducer permitted");
            if state.deny_probe {
                (StatusCode::FORBIDDEN, "private-denial-details").into_response()
            } else if state.uncertain_enrollment && body == "[true]" {
                (StatusCode::SERVICE_UNAVAILABLE, "uncertain-native-commit").into_response()
            } else {
                StatusCode::OK.into_response()
            }
        }
        let requests = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        let state = MockState {
            requests: requests.clone(),
            native,
            deny_probe,
            uncertain_enrollment,
        };
        let app = Router::new()
            .route("/v1/database/test/sql", post(sql))
            .route("/v1/database/test/call/:name", post(call))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Mock {
            requests,
            task,
            client: StdbClient::new(
                format!("http://{addr}"),
                "test".into(),
                "synthetic-local-token".into(),
            ),
        }
    }

    #[tokio::test]
    async fn http_probe_denial_prevents_any_write_or_target_rpc() {
        let server = mock(native_fixture(false), true, false).await;
        assert!(authorized_snapshot(&server.client, &policy())
            .await
            .is_err());
        let requests = server.requests.lock().unwrap();
        assert!(requests.iter().any(|s| s == &format!("CALL {RPC} [false]")));
        assert!(!requests
            .iter()
            .any(|s| s.starts_with("UPDATE ") || s.contains("[true]")));
    }

    #[tokio::test]
    async fn http_probe_is_read_only_and_revoked_native_cannot_reach_it() {
        let server = mock(native_fixture(false), false, false).await;
        let result = authorized_snapshot(&server.client, &policy()).await;
        assert!(
            result.is_ok(),
            "snapshot failed: {}; requests: {:?}",
            result.err().unwrap(),
            server.requests.lock().unwrap(),
        );
        let requests = server.requests.lock().unwrap();
        assert_eq!(
            requests.iter().filter(|s| s.starts_with("CALL ")).count(),
            1
        );
        assert!(requests.iter().all(|s| !s.starts_with("UPDATE ")));
        drop(requests);
        for key in ["is_active", "is_superuser"] {
            let mut n = native_fixture(true);
            n.profile[key] = json!(false);
            let revoked = mock(n, false, false).await;
            assert!(authorized_snapshot(&revoked.client, &policy())
                .await
                .is_err());
            assert!(revoked
                .requests
                .lock()
                .unwrap()
                .iter()
                .all(|s| !s.starts_with("CALL ") && !s.starts_with("UPDATE ")));
        }
    }

    #[tokio::test]
    async fn http_active_or_mixed_bootstrap_state_never_reaches_enrollment() {
        for (profile_active, membership_active) in [(true, false), (false, true), (true, true)] {
            let mut native = native_fixture(false);
            native.profile["is_active"] = json!(profile_active);
            native.membership["is_active"] = json!(membership_active);
            let server = mock(native, false, false).await;
            assert!(authorized_snapshot(&server.client, &policy())
                .await
                .is_err());
            assert!(server
                .requests
                .lock()
                .unwrap()
                .iter()
                .all(|request| request.starts_with("SELECT ")));
        }
    }

    #[tokio::test]
    async fn http_uncertain_enrollment_stops_without_retry_or_projection() {
        let n = native_fixture(false);
        let server = mock(n.clone(), false, true).await;
        assert!(enroll_native(&server.client, &n, &policy()).await.is_err());
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0], format!("CALL {RPC} [true]"));
    }

    /// Run against a NEW isolated local database, never the application database:
    /// PG_DATABASE=lumiere_operator_test_<suffix> PG_HOST=127.0.0.1 PG_PORT=...
    /// cargo test -p api-server platform_operator::tests::postgres_projection -- --ignored
    #[tokio::test]
    #[ignore = "requires an explicitly isolated local PostgreSQL database"]
    async fn postgres_projection_locks_revalidates_and_preserves_existing_row() {
        let config = PgConfig::from_env().unwrap();
        assert!(matches!(config.host.as_str(), "localhost" | "127.0.0.1"));
        assert!(config.database.starts_with("lumiere_operator_test_"));
        let pool = build_pool(&config).unwrap();
        let client = pool.get().await.unwrap();
        // CREATE SCHEMA intentionally fails if the database is not pristine.
        client
            .batch_execute(
                "CREATE SCHEMA lumiere_platform;
             CREATE TABLE lumiere_platform.user_profile (
                 platform_user_id text PRIMARY KEY, stdb_identity_hex text UNIQUE NOT NULL,
                 name text NOT NULL, is_active boolean NOT NULL, is_superuser boolean NOT NULL,
                 metadata jsonb NOT NULL);
             CREATE TABLE lumiere_platform.user_credential (
                 platform_user_id text UNIQUE, stdb_identity_hex text UNIQUE);",
            )
            .await
            .unwrap();
        let n = native_fixture(true);
        let p = policy();
        client.execute(
            "INSERT INTO lumiere_platform.user_profile VALUES ('p_test_operator',$1,'untouched',false,false,$2)",
            &[&p.identity_hex, &json!(n.origin)]
        ).await.unwrap();
        let before = canonical(&pool, &n, &p).await.unwrap();
        project(&pool, &before, &n, &p).await.unwrap();
        let after = canonical(&pool, &n, &p).await.unwrap();
        assert!(ready(&after, &n).unwrap());
        assert_eq!(after["name"], "untouched");
        let projected = client.query_one(
            "SELECT is_active,metadata::text AS bootstrap_metadata FROM lumiere_platform.user_profile WHERE platform_user_id='p_test_operator'",
            &[],
        ).await.unwrap();
        assert!(projected.get::<_, bool>("is_active"));
        assert!(!crate::platform_control::profile_is_active(&projected));
        stable_delta(&before, &after, &["is_active", "is_superuser", "metadata"]).unwrap();
        // Read-only inspection also has server-side lock/statement bounds.
        let mut blocker = pool.get().await.unwrap();
        let blocked = blocker.transaction().await.unwrap();
        blocked
            .batch_execute("LOCK TABLE lumiere_platform.user_profile IN ACCESS EXCLUSIVE MODE")
            .await
            .unwrap();
        assert!(matches!(
            tokio::time::timeout(std::time::Duration::from_secs(8), canonical(&pool, &n, &p)).await,
            Ok(Err(_))
        ));
        blocked.rollback().await.unwrap();
        // A stale snapshot never overwrites the canonical row.
        assert!(project(&pool, &before, &n, &p).await.is_err());
        // Full --apply replay must not project; use the real HTTP read/probe path.
        let server = mock(n.clone(), false, false).await;
        assert_eq!(
            execute(Mode::Apply, &p, &server.client, &pool)
                .await
                .unwrap()["changed"],
            false
        );
        assert_eq!(canonical(&pool, &n, &p).await.unwrap(), after);

        // An unavailable native read is NOT revocation evidence.
        let unavailable = StdbClient::new(
            "http://127.0.0.1:0".into(),
            "test".into(),
            "synthetic-local-token".into(),
        );
        assert!(confirm_native_or_compensate(&unavailable, &pool, &n, &p)
            .await
            .is_err());
        assert_eq!(canonical(&pool, &n, &p).await.unwrap(), after);

        // Simulate native revocation after projection committed. A successful
        // HTTP read confirms it, so only this projection's flags go downward.
        let mut revoked_native = n.clone();
        revoked_native.profile["is_superuser"] = json!(false);
        let revoked_server = mock(revoked_native, false, false).await;
        assert!(
            confirm_native_or_compensate(&revoked_server.client, &pool, &n, &p)
                .await
                .is_err()
        );
        let repaired: Value = client.query_one(
            "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id='p_test_operator'",
            &[],
        ).await.unwrap().get(0);
        assert_eq!(repaired["is_active"], false);
        assert_eq!(repaired["is_superuser"], false);
        assert_eq!(repaired["metadata"], after["metadata"]);
        stable_delta(&after, &repaired, &["is_active", "is_superuser"]).unwrap();
        assert!(
            project(&pool, &repaired, &n, &p).await.is_err(),
            "never regrant revoked persistent projection"
        );

        // A concurrent metadata replacement is not this invocation's projection:
        // the downward guard must leave its flags AND all other fields alone.
        let replacement =
            json!({"persistent_platform_operator_v1":{"approvalRef":"changed-concurrently"}});
        client.execute(
            "UPDATE lumiere_platform.user_profile SET metadata=$1,is_active=true,is_superuser=true",
            &[&replacement],
        ).await.unwrap();
        let changed: Value = client.query_one(
            "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id='p_test_operator'",
            &[],
        ).await.unwrap().get(0);
        assert!(!compensate_projection(&pool, &n, &p).await.unwrap());
        let unchanged: Value = client.query_one(
            "SELECT to_jsonb(p) FROM lumiere_platform.user_profile p WHERE platform_user_id='p_test_operator'",
            &[],
        ).await.unwrap().get(0);
        assert_eq!(changed, unchanged);

        // Transaction-scoped credential locks must be gone after projection
        // and compensation return, including failures. A real writer proves it.
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            client.execute(
                "INSERT INTO lumiere_platform.user_credential VALUES ('p_test_operator',$1)",
                &[&p.identity_hex],
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(project(&pool, &after, &n, &p).await.is_err());
        assert!(canonical(&pool, &n, &p).await.is_err());
        // No secret columns are needed anywhere in this integration fixture.
    }
}
