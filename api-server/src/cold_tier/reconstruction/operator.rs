//! Trusted operator entrypoint for one organization reconstruction.

use super::{
    reconstruct_organization_once, PgReconstructionSource, ReconstructionReport,
    ReconstructionSource,
};
use crate::cold_tier::pg_pool::{build_pool, PgConfig};
use crate::organization_placement::{
    CellId, DurableStoreId, OrganizationPlacement, PlacementGeneration,
};
use anyhow::{bail, Context, Result};
use rand::RngCore;
use serde_json::{json, Value};
use stdb_client::StdbClient;
use stdb_config::{
    env_stdb_host_or_next_public, env_stdb_module_or_next_public, normalize_stdb_http_host,
};

const RECONSTRUCTION_TOKEN_ENV: &str = "STDB_RECONSTRUCTION_TOKEN";
const RECONSTRUCTION_IDENTITY_ENV: &str = "STDB_RECONSTRUCTION_IDENTITY";
const PLACEMENT_GENERATION_ENV: &str = "RECONSTRUCTION_PLACEMENT_GENERATION";
const CELL_ID_ENV: &str = "RECONSTRUCTION_CELL_ID";
const DURABLE_STORE_ID_ENV: &str = "RECONSTRUCTION_DURABLE_STORE_ID";

/// Reconstruct one operator-selected organization using only server-resolved
/// placement configuration and the exact durable PostgreSQL watermark.
pub async fn run_organization_reconstruction(organization_id: u64) -> Result<ReconstructionReport> {
    if organization_id == 0 {
        bail!("organization id must be non-zero");
    }
    let settings = ReconstructionSettings::from_env()?;
    let pg_config = PgConfig::from_env()?;
    let pool = build_pool(&pg_config)?;
    let source = PgReconstructionSource::new(pool.clone());
    let watermark = source
        .declared_watermark(organization_id)
        .await
        .context("resolve exact durable reconstruction watermark")?;
    let target = settings.target(organization_id)?;
    let stdb = StdbClient::new(settings.stdb_host, settings.stdb_module, settings.token);
    let run_id = configured_run_id(organization_id)?;
    eprintln!("starting C7 reconstruction run {run_id}");
    ensure_reconstructor_binding(&stdb, organization_id, &settings.identity).await?;
    reconstruct_organization_once(&stdb, &pool, &target, watermark, run_id).await
}

async fn ensure_reconstructor_binding(
    stdb: &StdbClient,
    organization_id: u64,
    identity: &str,
) -> Result<()> {
    let rows = stdb
        .query_sql(&format!(
            "SELECT identity, is_active FROM cold_tier_service_identity \
             WHERE organization_id = {organization_id} \
             AND service_name = 'organization_reconstructor'"
        ))
        .await
        .context("read destination reconstruction service binding")?;
    let active = rows
        .iter()
        .filter(|row| {
            row.get("isActive")
                .or_else(|| row.get("is_active"))
                .and_then(Value::as_bool)
                == Some(true)
        })
        .collect::<Vec<_>>();
    if active.len() > 1 {
        bail!("destination has multiple active organization reconstructors");
    }
    if let Some(row) = active.first() {
        let bound = identity_from_json(
            row.get("identity")
                .context("destination reconstructor row lacks identity")?,
        )?;
        if !bound.eq_ignore_ascii_case(identity) {
            bail!("destination reconstructor binding does not match STDB_RECONSTRUCTION_TOKEN");
        }
        return Ok(());
    }
    stdb.call_reducer(stdb_client::reducer_call!(
        "register_cold_tier_service_identity",
        json!([
            organization_id,
            format!("c7-reconstructor-{organization_id}-{}", random_hex::<8>()),
            "organization_reconstructor",
            json!({ "__identity__": format!("0x{identity}") }),
        ]),
    ))
    .await
    .context("bootstrap destination reconstruction service binding")
}

fn identity_from_json(value: &Value) -> Result<String> {
    let identity = value
        .as_str()
        .or_else(|| value.get("__identity__").and_then(Value::as_str))
        .context("decode destination reconstructor identity")?;
    normalize_identity(identity)
}

fn normalize_identity(identity: &str) -> Result<String> {
    let identity = identity
        .trim()
        .strip_prefix("0x")
        .unwrap_or(identity.trim());
    if identity.len() != 64 || !identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("SpacetimeDB identity must be 64 hexadecimal characters");
    }
    Ok(identity.to_ascii_lowercase())
}

struct ReconstructionSettings {
    stdb_host: String,
    stdb_module: String,
    token: String,
    identity: String,
    cell_id: CellId,
    durable_store: DurableStoreId,
    generation: PlacementGeneration,
}

impl ReconstructionSettings {
    fn from_env() -> Result<Self> {
        let stdb_host = env_stdb_host_or_next_public()
            .map(|host| normalize_stdb_http_host(&host))
            .context("STDB_HOST or NEXT_PUBLIC_STDB_HOST is required")?;
        let stdb_module = env_stdb_module_or_next_public()
            .context("STDB_MODULE or NEXT_PUBLIC_STDB_MODULE is required")?;
        let token = required_env(RECONSTRUCTION_TOKEN_ENV)?;
        if std::env::var("STDB_SERVER_TOKEN").ok().as_deref() == Some(token.as_str()) {
            bail!("STDB_RECONSTRUCTION_TOKEN must be distinct from STDB_SERVER_TOKEN");
        }
        let generation = required_env(PLACEMENT_GENERATION_ENV)?
            .parse::<u64>()
            .context("parse RECONSTRUCTION_PLACEMENT_GENERATION")?;
        Ok(Self {
            stdb_host,
            stdb_module,
            token,
            identity: normalize_identity(&required_env(RECONSTRUCTION_IDENTITY_ENV)?)?,
            cell_id: CellId::new(required_env(CELL_ID_ENV)?)?,
            durable_store: DurableStoreId::new(required_env(DURABLE_STORE_ID_ENV)?)?,
            generation: PlacementGeneration::new(generation)?,
        })
    }

    fn target(&self, organization_id: u64) -> Result<OrganizationPlacement> {
        OrganizationPlacement::reconstruction_target(
            organization_id,
            self.cell_id.clone(),
            self.generation,
            self.durable_store.clone(),
        )
        .map_err(Into::into)
    }
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} is required"))
}

fn new_run_id(organization_id: u64) -> String {
    format!("c7-{organization_id}-{}", random_hex::<16>())
}

fn random_hex<const N: usize>() -> String {
    let mut random = [0_u8; N];
    rand::thread_rng().fill_bytes(&mut random);
    hex::encode(random)
}

fn configured_run_id(organization_id: u64) -> Result<String> {
    let run_id = std::env::var("RECONSTRUCTION_RUN_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| new_run_id(organization_id));
    if run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        bail!("RECONSTRUCTION_RUN_ID has an invalid shape");
    }
    Ok(run_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_ids_are_bounded_unique_and_do_not_encode_placement() {
        let first = new_run_id(42);
        let second = new_run_id(42);
        assert_ne!(first, second);
        assert!(first.starts_with("c7-42-"));
        assert!(first.len() <= 128);
    }

    #[test]
    fn reconstruction_identity_is_explicit_and_normalized() {
        let identity = "ab".repeat(32);
        assert_eq!(
            normalize_identity(&format!("0x{identity}")).unwrap(),
            identity
        );
        assert!(normalize_identity("an-oidc-subject-is-not-an-identity").is_err());
    }

    #[test]
    fn destination_identity_accepts_sats_and_plain_shapes() {
        let identity = "cd".repeat(32);
        assert_eq!(identity_from_json(&json!(identity)).unwrap(), identity);
        assert_eq!(
            identity_from_json(&json!({ "__identity__": format!("0x{identity}") })).unwrap(),
            identity
        );
    }
}
