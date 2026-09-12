use anyhow::{Context, Result};
use std::path::PathBuf;
use stdb_config::{
    env_stdb_host_or_next_public, env_stdb_module_or_next_public, normalize_stdb_http_host,
    runtime_is_production, DEFAULT_STDB_MODULE_DEV,
};

use crate::organization_placement::{
    ConfiguredPlacementResolver, INITIAL_CELL_ID, INITIAL_DURABLE_STORE_ID,
};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub stdb_host: String,
    pub stdb_module: String,
    /// Server/admin token for SQL fallback (same as `STDB_SERVER_TOKEN` in Next.js).
    pub stdb_server_token: Option<String>,
    /// Dedicated projection/finalization worker token. It must be distinct from
    /// `STDB_SERVER_TOKEN`; finalizer reducers authenticate its registered identity.
    pub stdb_finalization_token: Option<String>,
    /// Server-owned placement used to bind every trusted operation to the
    /// current deployment generation. Production must configure it explicitly.
    pub organization_placement: ConfiguredPlacementResolver,
    /// Allowed browser origins for CORS (comma-separated). Empty → common localhost dev URLs.
    pub cors_origins: Vec<String>,
    pub dev_mock_org_id: Option<u64>,
    /// AI gateway base URL (no trailing slash); proposals analyze proxies to `{url}/v1/rag`.
    pub ai_gateway_url: String,
    /// Maximum age of an unprojected commit before projection is unhealthy.
    pub projection_lag_budget_secs: u64,
    /// When set, password auth routes return 410 (same as Next.js + WorkOS).
    pub workos_client_id: Option<String>,
    /// AES-256 key for `stdb_token_enc` (32 bytes, 64 hex chars). Required for password auth.
    pub stdb_credential_encryption_key: Option<[u8; 32]>,
    pub resend_api_key: Option<String>,
    pub resend_from_email: String,
    pub app_url: String,
    pub cookie_secure: bool,
    /// Trusted internal Chromium worker used only for owner-report PDFs.
    pub report_renderer_url: Option<String>,
    /// Mounted, durable object-store volume for opaque owner-report artifacts.
    pub report_artifact_dir: PathBuf,
    /// Local object-store root for DMS document blobs (presign/upload/complete).
    pub document_blob_dir: PathBuf,
    /// Bounded polling interval for the scheduled owner-report worker.
    pub owner_report_worker_poll_secs: u64,
    /// Stable worker name used for queue registration and heartbeats.
    pub owner_report_worker_name: String,
    /// Internal health listener for the standalone owner-report worker.
    pub owner_report_worker_port: u16,
    /// Bounded polling interval for the workflow timer/outbox worker.
    pub workflow_worker_poll_secs: u64,
    pub workflow_worker_name: String,
    pub workflow_worker_port: u16,
    /// Organization shard for the worker; empty = discover from due timers.
    pub workflow_worker_org_ids: Vec<u64>,
    pub workflow_worker_lease_ttl_secs: u64,
    /// When false (default), timers still fire but outbox jobs are not claimed.
    pub workflow_external_dispatch_enabled: bool,
    /// When non-empty and dispatch is on, only these company IDs are claimed.
    pub workflow_external_dispatch_company_ids: Vec<u64>,
    /// When non-empty and dispatch is on, only these action keys are claimed.
    /// Empty with a webhook URL configured rejects all HTTP claims (fail closed).
    pub workflow_external_dispatch_action_keys: Vec<String>,
    /// Optional webhook for real external adapters. When unset, a deterministic
    /// fingerprint adapter is used (dev/test).
    pub workflow_external_webhook_url: Option<String>,
    /// HTTP timeout for the webhook adapter; must stay below lease TTL.
    pub workflow_external_webhook_timeout_ms: u64,
}

impl Config {
    /// Load the dedicated bearer credential for a privileged worker.
    ///
    /// Worker clients must not silently inherit the interactive/server-owner
    /// token or another service credential. The deployment remains responsible
    /// for granting this identity only the reducers and reads that worker
    /// needs.
    pub(crate) fn require_dedicated_worker_token(&self, env_name: &str) -> Result<String> {
        let token = std::env::var(env_name)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .with_context(|| format!("{env_name} is required for its privileged worker"))?;
        let configured_service_tokens = DEDICATED_SERVICE_TOKEN_ENVS
            .iter()
            .filter(|name| **name != env_name)
            .filter_map(|name| {
                std::env::var(name)
                    .ok()
                    .map(|value| ((*name).to_owned(), value.trim().to_owned()))
            })
            .collect::<Vec<_>>();
        validate_dedicated_worker_token(
            env_name,
            &token,
            self.stdb_server_token.as_deref(),
            &configured_service_tokens,
        )?;
        Ok(token)
    }

    pub fn from_env() -> Result<Self> {
        Self::from_env_inner(true)
    }

    /// Standalone workers use dedicated identities and must not require the
    /// interactive API owner credential merely to parse shared settings.
    pub(crate) fn from_worker_env() -> Result<Self> {
        Self::from_env_inner(false)
    }

    fn from_env_inner(require_server_token: bool) -> Result<Self> {
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8082);

        let prod = runtime_is_production();

        let stdb_host_raw = env_stdb_host_or_next_public()
            .unwrap_or_else(|| "https://maincloud.spacetimedb.com".to_string());
        let stdb_host = normalize_stdb_http_host(&stdb_host_raw);

        let stdb_module = if prod {
            env_stdb_module_or_next_public().context(
                "STDB_MODULE or NEXT_PUBLIC_STDB_MODULE must be set in production (publish name / database name)",
            )?
        } else {
            env_stdb_module_or_next_public().unwrap_or_else(|| DEFAULT_STDB_MODULE_DEV.to_string())
        };

        let stdb_server_token = std::env::var("STDB_SERVER_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if prod && require_server_token && stdb_server_token.is_none() {
            anyhow::bail!(
                "STDB_SERVER_TOKEN must be set in production (SpacetimeDB server/admin JWT for HTTP SQL)"
            );
        }
        let stdb_finalization_token = std::env::var("STDB_FINALIZATION_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let placement_generation = match std::env::var("LUMIERE_PLACEMENT_GENERATION") {
            Ok(value) => value
                .trim()
                .parse::<u64>()
                .context("LUMIERE_PLACEMENT_GENERATION must be a positive integer")?,
            Err(_) if prod => {
                anyhow::bail!("LUMIERE_PLACEMENT_GENERATION must be set in production")
            }
            Err(_) => 1,
        };
        let placement_cell_id = match std::env::var("LUMIERE_CELL_ID") {
            Ok(value) if !value.trim().is_empty() => value,
            _ if prod => anyhow::bail!("LUMIERE_CELL_ID must be set in production"),
            _ => INITIAL_CELL_ID.to_owned(),
        };
        let placement_durable_store = match std::env::var("LUMIERE_DURABLE_STORE_ID") {
            Ok(value) if !value.trim().is_empty() => value,
            _ if prod => anyhow::bail!("LUMIERE_DURABLE_STORE_ID must be set in production"),
            _ => INITIAL_DURABLE_STORE_ID.to_owned(),
        };
        let mut organization_placement = ConfiguredPlacementResolver::new(
            placement_cell_id.trim(),
            placement_generation,
            placement_durable_store.trim(),
        )
        .context("validate server-owned organization placement")?;
        if let Some(path) = std::env::var("LUMIERE_PLACEMENT_CONTROL_PATH")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
        {
            organization_placement = organization_placement
                .with_persistent_control_store(path)
                .context("configure persistent organization placement control store")?;
        }

        // CORS_ORIGINS: comma-separated http(s)://host:port; required for credentialed cross-origin
        // browser calls (wildcard * is invalid with credentials: include).
        let cors_origins: Vec<String> = std::env::var("CORS_ORIGINS")
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        let dev_mock_org_id = std::env::var("DEV_MOCK_ORG_ID")
            .ok()
            .and_then(|s| s.parse().ok());
        let dev_mock_org_id = if prod && dev_mock_org_id.is_some() {
            tracing::warn!("DEV_MOCK_ORG_ID is set in production — ignoring dev mock bypass");
            None
        } else {
            dev_mock_org_id
        };

        let ai_gateway_url = if prod {
            std::env::var("AI_GATEWAY_URL")
                .context("AI_GATEWAY_URL must be set in production (internal AI gateway base URL, no trailing slash)")?
        } else {
            std::env::var("AI_GATEWAY_URL").unwrap_or_else(|_| "http://localhost:3001".to_string())
        }
        .trim_end_matches('/')
        .to_string();

        let projection_lag_budget_secs = parse_projection_lag_budget(
            std::env::var("LUMIERE_PROJECTION_LAG_BUDGET_SECS")
                .ok()
                .as_deref(),
        )?;

        if prod {
            let lower = ai_gateway_url.to_lowercase();
            if lower.contains("localhost") || lower.contains("127.0.0.1") {
                anyhow::bail!(
                    "AI_GATEWAY_URL must not point at localhost in production (got {ai_gateway_url})"
                );
            }
        }

        let workos_client_id = std::env::var("WORKOS_CLIENT_ID")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let stdb_credential_encryption_key = std::env::var("STDB_CREDENTIAL_ENCRYPTION_KEY")
            .ok()
            .and_then(|h| {
                let h = h.trim();
                if h.len() < 64 {
                    return None;
                }
                let mut k = [0u8; 32];
                hex::decode_to_slice(&h.as_bytes()[..64], &mut k).ok()?;
                Some(k)
            });

        let resend_api_key = std::env::var("RESEND_API_KEY")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let resend_from_email =
            std::env::var("RESEND_FROM_EMAIL").unwrap_or_else(|_| "noreply@lumiere-erp.com".into());
        let app_url = std::env::var("NEXT_PUBLIC_APP_URL")
            .unwrap_or_else(|_| "http://localhost:3000".into())
            .trim_end_matches('/')
            .to_string();

        let cookie_secure = std::env::var("NODE_ENV")
            .map(|v| v == "production")
            .unwrap_or(false)
            || std::env::var("COOKIE_FORCE_SECURE")
                .map(|v| v == "true")
                .unwrap_or(false);
        let report_renderer_url = std::env::var("LUMIERE_REPORT_RENDERER_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim_end_matches('/').to_string());
        let report_artifact_dir = std::env::var("LUMIERE_REPORT_ARTIFACT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("lumiere-owner-reports"));
        let document_blob_dir = std::env::var("LUMIERE_DOCUMENT_BLOB_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("lumiere-document-blobs"));
        let owner_report_worker_poll_secs = std::env::var("LUMIERE_OWNER_REPORT_WORKER_POLL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(15);
        let owner_report_worker_name = std::env::var("LUMIERE_OWNER_REPORT_WORKER_NAME")
            .unwrap_or_else(|_| "owner-report-worker-v1".to_string());
        let owner_report_worker_port = std::env::var("LUMIERE_OWNER_REPORT_WORKER_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(8091);
        let workflow_worker_poll_secs = std::env::var("LUMIERE_WORKFLOW_WORKER_POLL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(15);
        let workflow_worker_name = std::env::var("LUMIERE_WORKFLOW_WORKER_NAME")
            .unwrap_or_else(|_| "workflow-worker-v1".to_string());
        let workflow_worker_port = std::env::var("LUMIERE_WORKFLOW_WORKER_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(8093);
        let workflow_worker_org_ids = std::env::var("LUMIERE_WORKFLOW_WORKER_ORG_IDS")
            .unwrap_or_default()
            .split(',')
            .filter_map(|s| s.trim().parse::<u64>().ok())
            .collect();
        let workflow_worker_lease_ttl_secs =
            std::env::var("LUMIERE_WORKFLOW_WORKER_LEASE_TTL_SECS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(60);
        let workflow_external_dispatch_enabled =
            std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ENABLED")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
        let workflow_external_dispatch_company_ids: Vec<u64> =
            std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_COMPANY_IDS")
                .unwrap_or_default()
                .split(',')
                .filter_map(|s| s.trim().parse::<u64>().ok())
                .collect();
        let workflow_external_dispatch_action_keys: Vec<String> =
            std::env::var("LUMIERE_WORKFLOW_EXTERNAL_DISPATCH_ACTION_KEYS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        let workflow_external_webhook_url = std::env::var("LUMIERE_WORKFLOW_EXTERNAL_WEBHOOK_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let workflow_external_webhook_timeout_ms =
            std::env::var("LUMIERE_WORKFLOW_EXTERNAL_WEBHOOK_TIMEOUT_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(10_000);
        if workflow_external_dispatch_enabled
            && workflow_external_webhook_url.is_some()
            && workflow_external_dispatch_action_keys.is_empty()
        {
            tracing::warn!(
                "external webhook configured but action-key allowlist is empty; HTTP claims will be skipped"
            );
        }

        Ok(Config {
            port,
            stdb_host,
            stdb_module,
            stdb_server_token,
            stdb_finalization_token,
            organization_placement,
            cors_origins,
            dev_mock_org_id,
            ai_gateway_url,
            projection_lag_budget_secs,
            workos_client_id,
            stdb_credential_encryption_key,
            resend_api_key,
            resend_from_email,
            app_url,
            cookie_secure,
            report_renderer_url,
            report_artifact_dir,
            document_blob_dir,
            owner_report_worker_poll_secs,
            owner_report_worker_name,
            owner_report_worker_port,
            workflow_worker_poll_secs,
            workflow_worker_name,
            workflow_worker_port,
            workflow_worker_org_ids,
            workflow_worker_lease_ttl_secs,
            workflow_external_dispatch_enabled,
            workflow_external_dispatch_company_ids,
            workflow_external_dispatch_action_keys,
            workflow_external_webhook_url,
            workflow_external_webhook_timeout_ms,
        })
    }
}

const DEFAULT_PROJECTION_LAG_BUDGET_SECS: u64 = 300;

const DEDICATED_SERVICE_TOKEN_ENVS: &[&str] = &[
    "STDB_OWNER_REPORT_WORKER_TOKEN",
    "STDB_WORKFLOW_WORKER_TOKEN",
    "STDB_EXPENSE_WORKER_TOKEN",
    "STDB_HR_WORKER_TOKEN",
    "STDB_PROJECT_WORKER_TOKEN",
    "STDB_FINALIZATION_TOKEN",
    "STDB_RECONSTRUCTION_TOKEN",
    "STDB_RECONSTRUCTION_READ_TOKEN",
];

fn validate_dedicated_worker_token(
    env_name: &str,
    token: &str,
    server_token: Option<&str>,
    configured_service_tokens: &[(String, String)],
) -> Result<()> {
    if token.is_empty() || token == "local-dev-token" {
        anyhow::bail!("{env_name} must contain a real dedicated STDB token");
    }
    if server_token.map(str::trim) == Some(token) {
        anyhow::bail!("{env_name} must be distinct from STDB_SERVER_TOKEN");
    }
    if let Some((other_name, _)) = configured_service_tokens
        .iter()
        .find(|(_, other_token)| !other_token.is_empty() && other_token.as_str() == token)
    {
        anyhow::bail!("{env_name} must be distinct from {other_name}");
    }
    Ok(())
}

fn parse_projection_lag_budget(raw: Option<&str>) -> Result<u64> {
    let Some(raw) = raw else {
        return Ok(DEFAULT_PROJECTION_LAG_BUDGET_SECS);
    };
    let value = raw
        .trim()
        .parse::<u64>()
        .context("LUMIERE_PROJECTION_LAG_BUDGET_SECS must be a positive integer")?;
    if value == 0 {
        anyhow::bail!("LUMIERE_PROJECTION_LAG_BUDGET_SECS must be greater than zero");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{parse_projection_lag_budget, validate_dedicated_worker_token};

    #[test]
    fn projection_lag_budget_defaults_and_rejects_zero_or_invalid_values() {
        assert_eq!(parse_projection_lag_budget(None).unwrap(), 300);
        assert_eq!(parse_projection_lag_budget(Some(" 45 ")).unwrap(), 45);
        assert!(parse_projection_lag_budget(Some("0")).is_err());
        assert!(parse_projection_lag_budget(Some("not-a-number")).is_err());
    }

    #[test]
    fn dedicated_worker_tokens_are_explicit_and_distinct() {
        let peers = vec![
            ("STDB_WORKFLOW_WORKER_TOKEN".into(), "workflow".into()),
            ("STDB_FINALIZATION_TOKEN".into(), "finalizer".into()),
        ];
        assert!(validate_dedicated_worker_token(
            "STDB_OWNER_REPORT_WORKER_TOKEN",
            "",
            Some("server"),
            &peers
        )
        .is_err());
        assert!(validate_dedicated_worker_token(
            "STDB_OWNER_REPORT_WORKER_TOKEN",
            "local-dev-token",
            Some("server"),
            &peers
        )
        .is_err());
        assert!(validate_dedicated_worker_token(
            "STDB_OWNER_REPORT_WORKER_TOKEN",
            "server",
            Some("server"),
            &peers
        )
        .is_err());
        assert!(validate_dedicated_worker_token(
            "STDB_OWNER_REPORT_WORKER_TOKEN",
            "workflow",
            Some("server"),
            &peers
        )
        .is_err());
        assert!(validate_dedicated_worker_token(
            "STDB_OWNER_REPORT_WORKER_TOKEN",
            "owner-report",
            Some("server"),
            &peers
        )
        .is_ok());
    }
}
