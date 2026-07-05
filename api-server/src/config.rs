use anyhow::{Context, Result};
use stdb_config::{
    env_stdb_host_or_next_public, env_stdb_module_or_next_public, normalize_stdb_http_host,
    runtime_is_production, DEFAULT_STDB_MODULE_DEV,
};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub stdb_host: String,
    pub stdb_module: String,
    /// Server/admin token for SQL fallback (same as `STDB_SERVER_TOKEN` in Next.js).
    pub stdb_server_token: Option<String>,
    /// Allowed browser origins for CORS (comma-separated). Empty → common localhost dev URLs.
    pub cors_origins: Vec<String>,
    pub dev_mock_org_id: Option<u64>,
    /// AI gateway base URL (no trailing slash); proposals analyze proxies to `{url}/v1/rag`.
    pub ai_gateway_url: String,
    /// When set, password auth routes return 410 (same as Next.js + WorkOS).
    pub workos_client_id: Option<String>,
    /// AES-256 key for `stdb_token_enc` (32 bytes, 64 hex chars). Required for password auth.
    pub stdb_credential_encryption_key: Option<[u8; 32]>,
    pub resend_api_key: Option<String>,
    pub resend_from_email: String,
    pub app_url: String,
    pub cookie_secure: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
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
            .filter(|s| !s.is_empty());
        if prod && stdb_server_token.is_none() {
            anyhow::bail!(
                "STDB_SERVER_TOKEN must be set in production (SpacetimeDB server/admin JWT for HTTP SQL)"
            );
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

        Ok(Config {
            port,
            stdb_host,
            stdb_module,
            stdb_server_token,
            cors_origins,
            dev_mock_org_id,
            ai_gateway_url,
            workos_client_id,
            stdb_credential_encryption_key,
            resend_api_key,
            resend_from_email,
            app_url,
            cookie_secure,
        })
    }
}
