use anyhow::Result;

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

        let stdb_host = std::env::var("STDB_HOST")
            .or_else(|_| std::env::var("NEXT_PUBLIC_STDB_HOST"))
            .unwrap_or_else(|_| "https://maincloud.spacetimedb.com".into())
            .replace("wss://", "https://")
            .replace("ws://", "http://")
            .trim_end_matches('/')
            .to_string();

        let stdb_module = std::env::var("STDB_MODULE")
            .or_else(|_| std::env::var("NEXT_PUBLIC_STDB_MODULE"))
            .unwrap_or_else(|_| "lumiere-v1-j1uo0".into());

        let stdb_server_token = std::env::var("STDB_SERVER_TOKEN").ok().filter(|s| !s.is_empty());

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

        let ai_gateway_url = std::env::var("AI_GATEWAY_URL")
            .unwrap_or_else(|_| "http://localhost:3001".into())
            .trim_end_matches('/')
            .to_string();

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
        let resend_from_email = std::env::var("RESEND_FROM_EMAIL")
            .unwrap_or_else(|_| "noreply@lumiere-erp.com".into());
        let app_url = std::env::var("NEXT_PUBLIC_APP_URL")
            .unwrap_or_else(|_| "http://localhost:3000".into())
            .trim_end_matches('/')
            .to_string();

        let cookie_secure = std::env::var("NODE_ENV").map(|v| v == "production").unwrap_or(false)
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
