use anyhow::{anyhow, Result};

const FORBIDDEN: &[&str] = &[
    "ATTACH", "COPY", "CREATE", "DELETE", "DROP", "EXPORT", "IMPORT", "INSTALL", "LOAD",
    "INSERT", "UPDATE", "PRAGMA", "ALTER", "GRANT", "VACUUM",
];

pub fn validate_read_only_sql(sql: &str) -> Result<String> {
    let trimmed = sql.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("sql is required"));
    }
    if trimmed.contains(';') {
        return Err(anyhow!("multi-statement sql is not allowed"));
    }
    let upper = trimmed.to_ascii_uppercase();
    for token in FORBIDDEN {
        if contains_word(&upper, token) {
            return Err(anyhow!("sql statement '{token}' is not allowed in sandbox"));
        }
    }
    if !(upper.starts_with("SELECT") || upper.starts_with("WITH") || upper.starts_with("DESCRIBE")) {
        return Err(anyhow!("only SELECT/WITH/DESCRIBE queries are allowed"));
    }
    Ok(trimmed.to_string())
}

fn contains_word(haystack: &str, word: &str) -> bool {
    haystack
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .any(|part| part == word)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_copy() {
        assert!(validate_read_only_sql("COPY x TO '/tmp/x'").is_err());
    }

    #[test]
    fn allows_select() {
        assert!(validate_read_only_sql("SELECT count(*) FROM sale_order_lines").is_ok());
    }
}
