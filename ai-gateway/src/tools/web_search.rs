use chrono::Utc;
use serde_json::{json, Value};

use crate::{
    providers::web_search::{
        domain_allowed, extract_host, filter_hits, hits_to_json, strip_html_basic, WebSearchRequest,
    },
    tools::types::{SkillCitation, ToolContext, ToolOutput, ToolResult},
};

const DEFAULT_MAX_RESULTS: u32 = 8;

pub async fn execute_search(ctx: &ToolContext, input: &Value) -> ToolResult {
    let query = input
        .get("query")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("query is required"))?
        .to_string();

    let max_results = input
        .get("max_results")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .or_else(|| {
            ctx.config_json
                .get("max_web_results")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)
        })
        .unwrap_or(DEFAULT_MAX_RESULTS);

    let preferred = string_list(&ctx.config_json, "preferred_supplier_domains");
    let blocked = string_list(&ctx.config_json, "blocked_domains");

    let hits = ctx
        .state
        .providers
        .web_search
        .search(WebSearchRequest {
            query: query.clone(),
            max_results,
        })
        .await?;

    let filtered = filter_hits(hits, &preferred, &blocked);
    let citations = filtered
        .iter()
        .map(|hit| web_citation(hit.title.clone(), hit.url.clone(), hit.snippet.clone()))
        .collect();

    let mut data = hits_to_json(&filtered);
    if let Some(obj) = data.as_object_mut() {
        obj.insert("query".to_string(), json!(query));
        obj.insert(
            "provider".to_string(),
            json!(ctx.state.providers.web_search.name()),
        );
    }

    Ok(ToolOutput {
        summary: format!(
            "Web search returned {} result(s) for '{}'",
            filtered.len(),
            query
        ),
        data,
        citations,
        row_count: Some(filtered.len() as u32),
    })
}

pub async fn execute_fetch(ctx: &ToolContext, input: &Value) -> ToolResult {
    let url = input
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("url is required"))?
        .to_string();

    if !url.starts_with("http://") && !url.starts_with("https://") {
        anyhow::bail!("only http(s) URLs are allowed");
    }

    let preferred = string_list(&ctx.config_json, "preferred_supplier_domains");
    let blocked = string_list(&ctx.config_json, "blocked_domains");
    if !domain_allowed(&url, &preferred, &blocked) {
        anyhow::bail!("URL domain is not allowed by skill configuration");
    }

    let max_bytes = input
        .get("max_bytes")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(ctx.state.config.web_fetch_max_bytes);

    let response = ctx
        .state
        .http
        .get(&url)
        .header("User-Agent", "Lumiere-AI-Gateway/1.0")
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("fetch url failed: {e}"))?;

    if !response.status().is_success() {
        anyhow::bail!("fetch url returned HTTP {}", response.status());
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let bytes = response
        .bytes()
        .await
        .map_err(|e| anyhow::anyhow!("read url body failed: {e}"))?;
    if bytes.len() > max_bytes {
        anyhow::bail!("response exceeds max size ({max_bytes} bytes)");
    }

    let raw = String::from_utf8_lossy(&bytes);
    let text = if content_type.contains("html") {
        strip_html_basic(&raw)
    } else {
        raw.chars().take(8_000).collect()
    };

    let title = extract_host(&url).unwrap_or_else(|| "web page".to_string());
    let citation = web_citation(title.clone(), url.clone(), text.chars().take(280).collect());

    Ok(ToolOutput {
        summary: format!("Fetched {} bytes from {url}", bytes.len()),
        data: json!({
            "url": url,
            "content_type": content_type,
            "bytes": bytes.len(),
            "text": text.chars().take(8_000).collect::<String>(),
        }),
        citations: vec![citation],
        row_count: Some(1),
    })
}

fn string_list(config: &Value, key: &str) -> Vec<String> {
    config
        .get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn web_citation(title: String, url: String, snippet: String) -> SkillCitation {
    SkillCitation {
        kind: "web".to_string(),
        trust: "retrieved".to_string(),
        content_type: None,
        entity_id: None,
        score: None,
        text_snippet: Some(snippet),
        label: Some(title),
        snapshot_at: Some(Utc::now().to_rfc3339()),
        url: Some(url),
        title: None,
        fetched_at: None,
    }
}
