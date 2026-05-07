//! Shared SpacetimeDB connection helpers for Lumiere Rust services (`api-server`, `ai-gateway`, `iot-gateway`).
//!
//! Environment alignment with TypeScript / Next.js:
//! - `STDB_HOST` — primary; falls back to `NEXT_PUBLIC_STDB_HOST` where services read both.
//! - `STDB_MODULE` — primary; falls back to `NEXT_PUBLIC_STDB_MODULE`.
//! - WebSocket `ws://` / `wss://` host values are normalized to `http://` / `https://` for HTTP clients.

/// Documented dev default when no env is set (align with Makefile `STDB_MODULE` / web fallbacks).
pub const DEFAULT_STDB_MODULE_DEV: &str = "lumiere-v1-j1uo0";

/// Normalize a SpacetimeDB HTTP API base URL: trim slashes, map `ws(s)` → `http(s)`.
pub fn normalize_stdb_http_host(raw: &str) -> String {
    raw.trim()
        .trim_end_matches('/')
        .replace("wss://", "https://")
        .replace("ws://", "http://")
}

/// `true` when the process should not rely on implicit development defaults.
pub fn runtime_is_production() -> bool {
    matches!(std::env::var("NODE_ENV").as_deref(), Ok("production"))
        || matches!(std::env::var("LUMIERE_ENV").as_deref(), Ok("production"))
}

/// First non-empty: `STDB_HOST`, then `NEXT_PUBLIC_STDB_HOST` (same as Next.js server).
pub fn env_stdb_host_or_next_public() -> Option<String> {
    std::env::var("STDB_HOST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            std::env::var("NEXT_PUBLIC_STDB_HOST")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

/// First non-empty: `STDB_MODULE`, then `NEXT_PUBLIC_STDB_MODULE`.
pub fn env_stdb_module_or_next_public() -> Option<String> {
    std::env::var("STDB_MODULE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            std::env::var("NEXT_PUBLIC_STDB_MODULE")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_ws_to_http() {
        assert_eq!(
            normalize_stdb_http_host("wss://maincloud.spacetimedb.com/"),
            "https://maincloud.spacetimedb.com"
        );
        assert_eq!(
            normalize_stdb_http_host("ws://127.0.0.1:3000"),
            "http://127.0.0.1:3000"
        );
    }
}
