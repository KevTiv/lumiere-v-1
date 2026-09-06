//! Postgres connection pool and TLS configuration.
//!
//! ## TLS modes
//!
//! | Mode | When | Behavior |
//! |------|------|---------|
//! | `Disable` | Development only | `NoTls` — no encryption. Fails closed in production. |
//! | `Require` | Production | `tokio-postgres-rustls` with native root certificates. |
//!
//! In production (`NODE_ENV=production`), the pool builder fails closed if
//! `PG_TLS_MODE` is not `require` or if the TLS connector cannot be
//! initialised.
//!
//! ## Environment variables
//!
//! | Variable | Default | Required in prod |
//! |----------|---------|-----------------|
//! | `PG_HOST` | `localhost` | yes |
//! | `PG_PORT` | `5432` | no |
//! | `PG_DATABASE` | `lumiere` | yes |
//! | `PG_USER` | `lumiere` | yes |
//! | `PG_PASSWORD` | _(empty)_ | yes |
//! | `PG_TLS_MODE` | `disable` | must be `require` |
//! | `PG_POOL_MAX` | `10` | no |
//! | `PG_CONNECT_TIMEOUT_SECS` | `10` | no |

use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, Result};
use deadpool_postgres::{Config as DeadpoolConfig, ManagerConfig, Pool, PoolConfig, Runtime};
use stdb_config::runtime_is_production;
use tokio_postgres::NoTls;

/// TLS mode for the PG connection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PgTlsMode {
    /// No TLS — development only.
    Disable,
    /// Require TLS with native root certificates — production.
    Require,
}

impl PgTlsMode {
    /// Parse from an environment-variable string.
    pub fn parse(s: &str) -> Result<Self> {
        match s.trim().to_lowercase().as_str() {
            "disable" | "" => Ok(Self::Disable),
            "require" | "tls" | "true" => Ok(Self::Require),
            other => {
                anyhow::bail!("PG_TLS_MODE: unknown value '{other}' (expected: disable | require)")
            }
        }
    }
}

/// Postgres configuration resolved from environment variables.
#[derive(Clone, Debug)]
pub struct PgConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub tls_mode: PgTlsMode,
    pub pool_max: usize,
    pub connect_timeout: Duration,
}

impl PgConfig {
    /// Read PG config from the environment.
    ///
    /// In production, fails if `PG_TLS_MODE` is not `require` or if required
    /// connection fields are missing.
    pub fn from_env() -> Result<Self> {
        let prod = runtime_is_production();

        let host = std::env::var("PG_HOST").unwrap_or_else(|_| "localhost".into());
        let port: u16 = std::env::var("PG_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5432);
        let database = std::env::var("PG_DATABASE").unwrap_or_else(|_| "lumiere".into());
        let user = std::env::var("PG_USER").unwrap_or_else(|_| "lumiere".into());
        let password = std::env::var("PG_PASSWORD").unwrap_or_default();
        let pool_max: usize = std::env::var("PG_POOL_MAX")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);
        let connect_timeout_secs: u64 = std::env::var("PG_CONNECT_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let tls_mode_str = std::env::var("PG_TLS_MODE").unwrap_or_default();
        let tls_mode = PgTlsMode::parse(&tls_mode_str)
            .with_context(|| format!("parse PG_TLS_MODE='{}'", tls_mode_str))?;

        if prod {
            if tls_mode != PgTlsMode::Require {
                anyhow::bail!(
                    "PG_TLS_MODE must be 'require' in production (got '{}')",
                    tls_mode_str
                );
            }
            if password.is_empty() {
                anyhow::bail!("PG_PASSWORD must be set in production");
            }
            if host == "localhost" || host == "127.0.0.1" {
                anyhow::bail!("PG_HOST must not point at localhost in production (got '{host}')");
            }
        }

        Ok(Self {
            host,
            port,
            database,
            user,
            password,
            tls_mode,
            pool_max,
            connect_timeout: Duration::from_secs(connect_timeout_secs),
        })
    }
}

/// Build a `deadpool_postgres::Pool` from [`PgConfig`].
///
/// Uses `NoTls` in dev mode and `tokio-postgres-rustls` in production.
pub fn build_pool(config: &PgConfig) -> Result<Pool> {
    let mut deadpool_cfg = DeadpoolConfig::new();
    deadpool_cfg.host = Some(config.host.clone());
    deadpool_cfg.port = Some(config.port);
    deadpool_cfg.dbname = Some(config.database.clone());
    deadpool_cfg.user = Some(config.user.clone());
    deadpool_cfg.password = Some(config.password.clone());
    deadpool_cfg.manager = Some(ManagerConfig {
        recycling_method: deadpool_postgres::RecyclingMethod::Fast,
    });
    deadpool_cfg.connect_timeout = Some(config.connect_timeout);
    let mut pool_config = PoolConfig::new(config.pool_max);
    pool_config.timeouts.wait = Some(config.connect_timeout);
    deadpool_cfg.pool = Some(pool_config);

    match config.tls_mode {
        PgTlsMode::Disable => {
            // Development: no TLS.
            deadpool_cfg
                .create_pool(Some(Runtime::Tokio1), NoTls)
                .context("create deadpool-postgres pool (NoTls)")
        }
        PgTlsMode::Require => {
            // Production: rustls with native root certificates.
            let rustls_config = rustls_config().context("initialise rustls TLS config for PG")?;
            let tls = tokio_postgres_rustls::MakeRustlsConnect::new(rustls_config);
            deadpool_cfg
                .create_pool(Some(Runtime::Tokio1), tls)
                .context("create deadpool-postgres pool (rustls)")
        }
    }
}

/// Build a `rustls::ClientConfig` using native root certificates.
///
/// In production this loads the OS trust store via `rustls-native-certs`.
/// If the TLS connector cannot be initialised, the pool builder fails closed.
fn rustls_config() -> Result<rustls::ClientConfig> {
    use rustls_native_certs::load_native_certs;

    let result = load_native_certs();
    if !result.errors.is_empty() {
        let msgs: Vec<String> = result.errors.iter().map(|e| format!("{e:?}")).collect();
        anyhow::bail!("failed to load native certificates: {}", msgs.join("; "));
    }

    let mut roots = rustls::RootCertStore::empty();
    for cert in result.certs {
        roots
            .add(cert)
            .context("add native cert to rustls root store")?;
    }

    Ok(rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth())
}

/// Process-wide cold-tier PG pool, built lazily on first use.
///
/// Cold resource reads call this instead of threading a pool through every
/// `execute_resource_query*` call site.
///
/// The legacy optional accessor represents pool initialization, not permission
/// to serve incomplete data. PG-dependent reads must use [`required_pool`].
/// Configuration failures are cached until restart; readiness stays unhealthy.
static SHARED_POOL: OnceLock<Option<Pool>> = OnceLock::new();

pub fn shared_pool() -> Option<&'static Pool> {
    SHARED_POOL
        .get_or_init(|| match PgConfig::from_env().and_then(|cfg| build_pool(&cfg)) {
            Ok(pool) => Some(pool),
            Err(error) => {
                tracing::error!(%error, "PostgreSQL pool unavailable; dependent requests must fail");
                None
            }
        })
        .as_ref()
}

/// A missing durable store is an error, never an empty result set.
pub fn required_pool() -> Result<&'static Pool> {
    shared_pool().context("PostgreSQL pool is not configured correctly")
}

/// Bound both pool acquisition and a real database round trip for readiness.
pub async fn check_ready() -> Result<()> {
    bounded_readiness(Duration::from_secs(3), async {
        let client = required_pool()?
            .get()
            .await
            .context("acquire PostgreSQL readiness connection")?;
        client
            .simple_query("SELECT 1")
            .await
            .context("probe PostgreSQL readiness")?;
        Ok(())
    })
    .await
}

async fn bounded_readiness(
    timeout: Duration,
    probe: impl std::future::Future<Output = Result<()>>,
) -> Result<()> {
    tokio::time::timeout(timeout, probe)
        .await
        .context("PostgreSQL readiness probe timed out")?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn readiness_preserves_probe_failure_and_bounds_waiting() {
        let failed = bounded_readiness(Duration::from_secs(1), async {
            anyhow::bail!("database unavailable")
        })
        .await
        .unwrap_err();
        assert_eq!(failed.to_string(), "database unavailable");
        let timed_out = bounded_readiness(
            Duration::from_millis(1),
            std::future::pending::<Result<()>>(),
        )
        .await
        .unwrap_err();
        assert!(timed_out.to_string().contains("timed out"));
        assert!(bounded_readiness(Duration::from_secs(1), async { Ok(()) })
            .await
            .is_ok());
    }

    #[test]
    fn parse_tls_mode() {
        assert_eq!(PgTlsMode::parse("disable").unwrap(), PgTlsMode::Disable);
        assert_eq!(PgTlsMode::parse("").unwrap(), PgTlsMode::Disable);
        assert_eq!(PgTlsMode::parse("require").unwrap(), PgTlsMode::Require);
        assert_eq!(PgTlsMode::parse("REQUIRE").unwrap(), PgTlsMode::Require);
        assert_eq!(PgTlsMode::parse("tls").unwrap(), PgTlsMode::Require);
        assert!(PgTlsMode::parse("invalid").is_err());
    }
}
