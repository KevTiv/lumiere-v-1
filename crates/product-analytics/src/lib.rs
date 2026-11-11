//! Server-side product events with bounded delivery off the request path.

use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use reqwest::Url;
use serde_json::{json, Value};
use tokio::sync::mpsc;

const DEFAULT_HOST: &str = "https://eu.i.posthog.com";
const QUEUE_CAPACITY: usize = 128;

#[derive(Clone, Default)]
pub struct ProductAnalytics {
    sender: Option<mpsc::Sender<Capture>>,
}

#[derive(Clone, Copy)]
pub enum ProductEvent {
    TenantBootstrapped,
    AssistantTurnCompleted {
        organization_id: u64,
        company_id: u64,
        run_id: u64,
    },
    AssistantSetupBlocked {
        organization_id: u64,
        company_id: u64,
        code: &'static str,
    },
}

struct Capture {
    distinct_id: String,
    event: ProductEvent,
    timestamp: DateTime<Utc>,
}

impl Capture {
    fn payload(self, key: &str) -> Value {
        let (name, mut properties) = match self.event {
            ProductEvent::TenantBootstrapped => {
                ("api_tenant_bootstrapped", json!({ "source": "api" }))
            }
            ProductEvent::AssistantTurnCompleted {
                organization_id,
                company_id,
                run_id,
            } => (
                "assistant_turn_completed",
                json!({
                    "source": "ai_gateway",
                    "organization_id": organization_id.to_string(),
                    "company_id": company_id.to_string(),
                    "run_id": run_id.to_string(),
                }),
            ),
            ProductEvent::AssistantSetupBlocked {
                organization_id,
                company_id,
                code,
            } => (
                "assistant_setup_blocked",
                json!({
                    "source": "ai_gateway",
                    "organization_id": organization_id.to_string(),
                    "company_id": company_id.to_string(),
                    "code": code,
                }),
            ),
        };
        properties["$geoip_disable"] = json!(true);
        json!({
            "api_key": key,
            "event": name,
            "distinct_id": self.distinct_id,
            "timestamp": self.timestamp.to_rfc3339_opts(SecondsFormat::Millis, true),
            "properties": properties,
        })
    }
}

impl ProductAnalytics {
    pub fn from_env() -> Self {
        let Some(key) = std::env::var("POSTHOG_KEY")
            .ok()
            .map(|key| key.trim().to_owned())
            .filter(|key| !key.is_empty())
        else {
            return Self::default();
        };

        let host = std::env::var("POSTHOG_HOST").unwrap_or_default();
        let Some(endpoint) = capture_endpoint(&host) else {
            tracing::warn!("POSTHOG_HOST must be an HTTPS origin; product analytics disabled");
            return Self::default();
        };
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return Self::default();
        };
        let Ok(client) = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
        else {
            tracing::warn!("Could not initialize product analytics HTTP client");
            return Self::default();
        };

        let (sender, mut receiver) = mpsc::channel::<Capture>(QUEUE_CAPACITY);
        runtime.spawn(async move {
            while let Some(capture) = receiver.recv().await {
                match client
                    .post(endpoint.clone())
                    .json(&capture.payload(&key))
                    .send()
                    .await
                {
                    Ok(response) if response.status().is_success() => {}
                    Ok(response) => {
                        tracing::debug!(status = %response.status(), "PostHog capture rejected");
                    }
                    Err(_) => tracing::debug!("PostHog capture unavailable"),
                }
            }
        });
        Self {
            sender: Some(sender),
        }
    }

    /// Queue an event without waiting on capacity or network delivery.
    pub fn capture(&self, identity_hex: &str, event: ProductEvent) {
        let Some(sender) = &self.sender else {
            return;
        };
        let Some(distinct_id) = distinct_id(identity_hex) else {
            return;
        };
        let capture = Capture {
            distinct_id,
            event,
            timestamp: Utc::now(),
        };
        if sender.try_send(capture).is_err() {
            tracing::debug!("Dropped product analytics event because the queue is unavailable");
        }
    }
}

fn distinct_id(identity: &str) -> Option<String> {
    let identity = identity.trim();
    let hex = identity
        .strip_prefix("0x")
        .or_else(|| identity.strip_prefix("0X"))
        .unwrap_or(identity);
    (hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| format!("lumiere:{}", hex.to_ascii_lowercase()))
}

fn capture_endpoint(host: &str) -> Option<Url> {
    let host = host.trim();
    let mut url = Url::parse(if host.is_empty() { DEFAULT_HOST } else { host }).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    url.set_path("/i/v0/e/");
    Some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTITY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    #[test]
    fn capture_endpoint_defaults_to_eu_and_rejects_non_origins() {
        assert_eq!(
            capture_endpoint("").unwrap().as_str(),
            "https://eu.i.posthog.com/i/v0/e/"
        );
        assert_eq!(
            capture_endpoint("https://us.i.posthog.com/")
                .unwrap()
                .as_str(),
            "https://us.i.posthog.com/i/v0/e/"
        );
        for invalid in [
            "http://example.com",
            "https://example.com/api",
            "https://user:password@example.com",
            "https://example.com?secret=abc",
            "https://example.com#fragment",
        ] {
            assert!(capture_endpoint(invalid).is_none());
        }
    }

    #[test]
    fn capture_normalizes_ids_and_drops_when_the_queue_is_full() {
        let (sender, mut receiver) = mpsc::channel(1);
        let analytics = ProductAnalytics {
            sender: Some(sender),
        };
        let scoped = ProductEvent::AssistantSetupBlocked {
            organization_id: 42,
            company_id: 7,
            code: "ai_default_agent_not_provisioned",
        };
        analytics.capture("user@example.com", scoped);
        analytics.capture(&format!(" 0X{IDENTITY} "), scoped);
        analytics.capture(IDENTITY, ProductEvent::TenantBootstrapped);

        let mut payload = receiver.try_recv().unwrap().payload("test_project_token");
        let timestamp = payload
            .as_object_mut()
            .unwrap()
            .remove("timestamp")
            .unwrap();
        assert!(DateTime::parse_from_rfc3339(timestamp.as_str().unwrap()).is_ok());
        assert_eq!(
            payload,
            json!({
                "api_key": "test_project_token",
                "event": "assistant_setup_blocked",
                "distinct_id": format!("lumiere:{}", IDENTITY.to_ascii_lowercase()),
                "properties": {
                    "source": "ai_gateway",
                    "organization_id": "42",
                    "company_id": "7",
                    "code": "ai_default_agent_not_provisioned",
                    "$geoip_disable": true,
                },
            })
        );
        assert!(receiver.try_recv().is_err());
    }
}
