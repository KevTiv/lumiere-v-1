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

/// Runtime role used to separate durable-store responsibilities.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PgRole {
    Projection,
    Finalization,
    Reconstruction,
}

impl PgRole {
    fn credential_env(self) -> (&'static str, &'static str) {
        match self {
            Self::Projection => ("PG_PROJECTION_USER", "PG_PROJECTION_PASSWORD"),
            Self::Finalization => ("PG_FINALIZATION_USER", "PG_FINALIZATION_PASSWORD"),
            Self::Reconstruction => ("PG_RECONSTRUCTION_USER", "PG_RECONSTRUCTION_PASSWORD"),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Projection => "projection",
            Self::Finalization => "finalization",
            Self::Reconstruction => "reconstruction",
        }
    }
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
    /// Resolve a dedicated least-privilege role without changing the base
    /// configuration used by API/schema administration.
    pub fn for_role(&self, role: PgRole) -> Result<Self> {
        let (user_env, password_env) = role.credential_env();
        let user = required_role_env(user_env)?;
        let password = required_role_env(password_env)?;
        validate_role_credentials(role, &self.user, &user, &password)?;
        Ok(Self {
            user,
            password,
            ..self.clone()
        })
    }

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

fn required_role_env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{name} is required for its PostgreSQL role"))
}

fn validate_role_credentials(
    role: PgRole,
    base_user: &str,
    role_user: &str,
    role_password: &str,
) -> Result<()> {
    if role_user.is_empty() || role_password.is_empty() {
        anyhow::bail!(
            "{} PostgreSQL role credentials must not be blank",
            role.label()
        );
    }
    if role_user == base_user {
        anyhow::bail!(
            "{} PostgreSQL role user must be distinct from PG_USER",
            role.label()
        );
    }
    Ok(())
}

pub(crate) fn validate_distinct_role_users(roles: &[(&str, &str)]) -> Result<()> {
    for (index, (name, user)) in roles.iter().enumerate() {
        for (other_name, other_user) in roles.iter().skip(index + 1) {
            if user == other_user {
                anyhow::bail!(
                    "{} PostgreSQL role user must be distinct from {}",
                    name,
                    other_name
                );
            }
        }
    }
    Ok(())
}

/// Apply runtime grants after the generated durable schema exists. Role
/// creation and passwords remain deployment-owned; this function only grants
/// the capabilities required by each application worker.
pub(crate) async fn ensure_runtime_role_grants(
    pool: &Pool,
    projection_user: &str,
    finalization_user: &str,
    reconstruction_user: &str,
    finalization_tables: &[String],
) -> Result<()> {
    let sql = runtime_role_grants_sql(
        projection_user,
        finalization_user,
        reconstruction_user,
        finalization_tables,
    )?;
    pool.get()
        .await
        .context("get PostgreSQL admin client for runtime grants")?
        .batch_execute(&sql)
        .await
        .context("apply least-privilege PostgreSQL runtime grants")
}

fn runtime_role_grants_sql(
    projection_user: &str,
    finalization_user: &str,
    reconstruction_user: &str,
    finalization_tables: &[String],
) -> Result<String> {
    let projection = quote_identifier(projection_user)?;
    let finalization = quote_identifier(finalization_user)?;
    let reconstruction = quote_identifier(reconstruction_user)?;
    let mut finalization_relations = vec!["organization_projection_watermark".to_string()];
    finalization_relations.extend(finalization_tables.iter().cloned());
    finalization_relations.sort();
    finalization_relations.dedup();
    let finalization_relations = finalization_relations
        .iter()
        .map(|table| quote_identifier(table))
        .collect::<Result<Vec<_>>>()?
        .join(", ");

    Ok(format!(
        "REVOKE CREATE ON SCHEMA public FROM {projection}, {finalization}, {reconstruction};\n\
         GRANT USAGE ON SCHEMA public TO {projection}, {finalization}, {reconstruction};\n\
         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {projection};\n\
         GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {projection};\n\
         GRANT SELECT ON ALL TABLES IN SCHEMA public TO {reconstruction};\n\
         GRANT SELECT ON TABLE {finalization_relations} TO {finalization};\n\
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {projection};\n\
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {projection};\n\
         ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {reconstruction};"
    ))
}

fn quote_identifier(value: &str) -> Result<String> {
    if value.is_empty()
        || !value.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphanumeric() && (index > 0 || !byte.is_ascii_digit())
        })
    {
        anyhow::bail!("PostgreSQL role or relation name is not a safe identifier");
    }
    Ok(format!("\"{value}\""))
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

    #[test]
    fn role_credentials_require_separate_users_and_passwords() {
        assert!(
            validate_role_credentials(PgRole::Projection, "lumiere", "projection", "secret")
                .is_ok()
        );
        assert!(
            validate_role_credentials(PgRole::Projection, "lumiere", "lumiere", "secret").is_err()
        );
        assert!(
            validate_role_credentials(PgRole::Projection, "lumiere", "projection", "").is_err()
        );
    }

    #[test]
    fn runtime_roles_use_dedicated_credential_variables() {
        assert_eq!(
            PgRole::Projection.credential_env(),
            ("PG_PROJECTION_USER", "PG_PROJECTION_PASSWORD")
        );
        assert_eq!(
            PgRole::Finalization.credential_env(),
            ("PG_FINALIZATION_USER", "PG_FINALIZATION_PASSWORD")
        );
        assert_eq!(
            PgRole::Reconstruction.credential_env(),
            ("PG_RECONSTRUCTION_USER", "PG_RECONSTRUCTION_PASSWORD")
        );
    }

    #[test]
    fn runtime_role_users_must_be_pairwise_distinct() {
        assert!(validate_distinct_role_users(&[
            ("projection", "projection"),
            ("finalization", "finalization"),
            ("reconstruction", "reconstruction"),
        ])
        .is_ok());
        assert!(validate_distinct_role_users(&[
            ("projection", "shared"),
            ("finalization", "shared"),
        ])
        .is_err());
    }

    #[test]
    fn grants_keep_finalization_and_reconstruction_read_only() {
        let sql = runtime_role_grants_sql(
            "projection_worker",
            "finalization_worker",
            "reconstruction_worker",
            &["cold_pos_order".to_string()],
        )
        .expect("grant SQL");
        assert!(sql.contains(
            "GRANT SELECT ON TABLE \"cold_pos_order\", \"organization_projection_watermark\" TO \"finalization_worker\""
        ));
        assert!(sql
            .contains("GRANT SELECT ON ALL TABLES IN SCHEMA public TO \"reconstruction_worker\""));
        assert!(!sql.contains("DELETE ON ALL TABLES IN SCHEMA public TO \"finalization_worker\""));
        assert!(!sql.contains("DELETE ON ALL TABLES IN SCHEMA public TO \"reconstruction_worker\""));
        assert!(runtime_role_grants_sql("bad-role", "finalizer", "reader", &[]).is_err());
    }
}
