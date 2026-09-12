//! Session cookie creation and removal for STDB-backed authentication.
use crate::session::normalize_identity_hex_for_sql;
use cookie::time::Duration;
use cookie::{Cookie, SameSite};
use tower_cookies::Cookies;

pub(super) fn set_stdb_session_cookies(
    config: &crate::config::Config,
    cookies: &Cookies,
    token: &str,
    identity_hex: &str,
) {
    let id = normalize_identity_hex_for_sql(identity_hex);
    let max_age = Duration::seconds(60 * 60 * 24 * 30);
    let mut t = Cookie::build(("stdb_token", token.to_string()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(max_age)
        .build();
    t.set_secure(config.cookie_secure);
    cookies.add(t);
    let mut i = Cookie::build(("stdb_identity", id))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(max_age)
        .build();
    i.set_secure(config.cookie_secure);
    cookies.add(i);
}

pub(super) fn clear_stdb_session_cookies(config: &crate::config::Config, cookies: &Cookies) {
    // Cookie deletion must repeat the original path (and secure policy).
    // A pathless removal does not replace a `Path=/` session cookie in all
    // clients, which previously left the browser authenticated after signout.
    for name in ["stdb_token", "stdb_identity"] {
        let mut cookie = Cookie::build((name, ""))
            .path("/")
            .http_only(true)
            .same_site(SameSite::Lax)
            .build();
        cookie.set_secure(config.cookie_secure);
        cookies.remove(cookie);
    }
}
