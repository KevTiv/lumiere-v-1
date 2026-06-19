use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WebSearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub score: Option<f32>,
}

#[derive(Clone, Debug)]
pub struct WebSearchRequest {
    pub query: String,
    pub max_results: u32,
}

#[async_trait]
pub trait WebSearchProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn search(&self, req: WebSearchRequest) -> Result<Vec<WebSearchHit>>;
}

pub struct TavilyWebSearch {
    http: reqwest::Client,
    api_key: String,
}

impl TavilyWebSearch {
    pub fn new(http: reqwest::Client, api_key: String) -> Self {
        Self { http, api_key }
    }
}

#[derive(Deserialize)]
struct TavilyResponse {
    results: Vec<TavilyResult>,
}

#[derive(Deserialize)]
struct TavilyResult {
    title: String,
    url: String,
    content: Option<String>,
    score: Option<f64>,
}

#[async_trait]
impl WebSearchProvider for TavilyWebSearch {
    fn name(&self) -> &'static str {
        "tavily"
    }

    async fn search(&self, req: WebSearchRequest) -> Result<Vec<WebSearchHit>> {
        let max_results = req.max_results.clamp(1, 20);
        let body = serde_json::json!({
            "api_key": self.api_key,
            "query": req.query,
            "search_depth": "basic",
            "include_answer": false,
            "max_results": max_results,
        });
        let response = self
            .http
            .post("https://api.tavily.com/search")
            .json(&body)
            .send()
            .await
            .context("tavily search request")?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            anyhow::bail!("tavily search failed ({status}): {text}");
        }
        let parsed: TavilyResponse = response.json().await.context("parse tavily response")?;
        Ok(parsed
            .results
            .into_iter()
            .map(|row| WebSearchHit {
                title: row.title,
                url: row.url,
                snippet: row.content.unwrap_or_default(),
                score: row.score.map(|s| s as f32),
            })
            .collect())
    }
}

/// Returns an empty result set when no provider is configured (dev-friendly).
pub struct DisabledWebSearch;

#[async_trait]
impl WebSearchProvider for DisabledWebSearch {
    fn name(&self) -> &'static str {
        "disabled"
    }

    async fn search(&self, _req: WebSearchRequest) -> Result<Vec<WebSearchHit>> {
        Ok(Vec::new())
    }
}

pub fn build_web_search(
    http: reqwest::Client,
    provider: &str,
    api_key: Option<&str>,
) -> Box<dyn WebSearchProvider> {
    match provider {
        "tavily" => {
            if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
                return Box::new(TavilyWebSearch::new(http, key.to_string()));
            }
        }
        _ => {}
    }
    Box::new(DisabledWebSearch)
}

pub fn filter_hits(
    hits: Vec<WebSearchHit>,
    preferred_domains: &[String],
    blocked_domains: &[String],
) -> Vec<WebSearchHit> {
    hits.into_iter()
        .filter(|hit| domain_allowed(&hit.url, preferred_domains, blocked_domains))
        .collect()
}

pub fn domain_allowed(url: &str, preferred_domains: &[String], blocked_domains: &[String]) -> bool {
    let Some(host) = extract_host(url) else {
        return false;
    };
    if blocked_domains
        .iter()
        .any(|blocked| host_matches(&host, blocked))
    {
        return false;
    }
    if preferred_domains.is_empty() {
        return url.starts_with("http://") || url.starts_with("https://");
    }
    preferred_domains
        .iter()
        .any(|preferred| host_matches(&host, preferred))
}

fn host_matches(host: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    if pattern.is_empty() {
        return false;
    }
    let pattern = pattern.strip_prefix("https://").unwrap_or(&pattern);
    let pattern = pattern.strip_prefix("http://").unwrap_or(pattern);
    let pattern = pattern.split('/').next().unwrap_or(&pattern);
    host == pattern || host.ends_with(&format!(".{pattern}"))
}

pub fn extract_host(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split('/').next()?.split(':').next()?;
    Some(host.to_lowercase())
}

pub fn strip_html_basic(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(16_384));
    let mut in_tag = false;
    for ch in html.chars().take(50_000) {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn hits_to_json(hits: &[WebSearchHit]) -> Value {
    serde_json::json!({
        "results": hits.iter().map(|hit| serde_json::json!({
            "title": hit.title,
            "url": hit.url,
            "snippet": hit.snippet,
            "score": hit.score,
        })).collect::<Vec<_>>()
    })
}
