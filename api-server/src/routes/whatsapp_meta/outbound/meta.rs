//! Fixed-origin Meta lookups and deployment-owned, exact-account secrets.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::MetaTransport;
use crate::routes::whatsapp_meta::protocol::{fingerprint, valid_asset_id};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Credential {
    organization_id: String,
    account_id: String,
    business_account_id: String,
    phone_number_id: String,
    credentials_reference: String,
    access_token: String,
}

pub(crate) fn credential(
    organization: u64,
    account: u64,
    waba: &str,
    phone: &str,
    reference: &str,
) -> Result<String> {
    let encoded = std::env::var("LUMIERE_WHATSAPP_ACCOUNT_TOKENS")
        .map_err(|_| anyhow::anyhow!("WhatsApp account credentials are not provisioned"))?;
    if encoded.len() > 524288 {
        bail!("invalid WhatsApp credential configuration");
    }
    let entries: Vec<Credential> = serde_json::from_str(&encoded)
        .map_err(|_| anyhow::anyhow!("invalid WhatsApp credential configuration"))?;
    let mut matching = entries.into_iter().filter(|entry| {
        entry.organization_id == organization.to_string()
            && entry.account_id == account.to_string()
            && entry.business_account_id == waba
            && entry.phone_number_id == phone
            && entry.credentials_reference == reference
    });
    let entry = matching
        .next()
        .ok_or_else(|| anyhow::anyhow!("no deployment credential matches this WhatsApp sender"))?;
    if matching.next().is_some() || entry.access_token.trim().is_empty() {
        bail!("ambiguous or empty WhatsApp sender credential");
    }
    Ok(entry.access_token)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Template {
    pub id: String,
    pub name: String,
    pub language: String,
    pub body: String,
    pub parameter_count: usize,
    pub definition_digest: String,
}

/// Render positional placeholders once; parameter text is never reinterpreted.
pub(crate) fn render(body: &str, parameters: &[String]) -> Result<String> {
    let mut output = String::new();
    let mut remaining = body;
    while let Some(start) = remaining.find("{{") {
        output.push_str(&remaining[..start]);
        let tail = &remaining[start + 2..];
        let end = tail
            .find("}}")
            .ok_or_else(|| anyhow::anyhow!("invalid template"))?;
        let index: usize = tail[..end]
            .parse()
            .map_err(|_| anyhow::anyhow!("invalid placeholder"))?;
        let value = index
            .checked_sub(1)
            .and_then(|index| parameters.get(index))
            .ok_or_else(|| anyhow::anyhow!("missing template parameter"))?;
        output.push_str(value);
        remaining = &tail[end + 2..];
    }
    output.push_str(remaining);
    if output.trim().is_empty() || output.len() > 4000 {
        bail!("template output exceeds the supported message limit");
    }
    Ok(output)
}

fn supported_template(value: &Value) -> Option<Template> {
    if value.get("status")?.as_str()? != "APPROVED"
        || value.get("category")?.as_str()? != "UTILITY"
        || value.get("parameter_format").and_then(Value::as_str) == Some("NAMED")
    {
        return None;
    }
    let components = value.get("components")?.as_array()?;
    // No hidden headers, footers, buttons or documents outside the reviewed body.
    if components.len() != 1 || components[0].get("type")?.as_str()? != "BODY" {
        return None;
    }
    let body = components[0].get("text")?.as_str()?;
    let mut seen = std::collections::BTreeSet::new();
    let mut remaining = body;
    while let Some(start) = remaining.find("{{") {
        let tail = &remaining[start + 2..];
        let end = tail.find("}}")?;
        let index = tail[..end].parse::<usize>().ok()?;
        if index == 0 || index > 20 {
            return None;
        }
        seen.insert(index);
        remaining = &tail[end + 2..];
    }
    let count = seen.last().copied().unwrap_or(0);
    if seen.len() != count || body.len() > 4000 {
        return None;
    }
    Some(Template {
        id: value.get("id")?.as_str()?.to_owned(),
        name: value.get("name")?.as_str()?.to_owned(),
        language: value.get("language")?.as_str()?.to_owned(),
        body: body.to_owned(),
        parameter_count: count,
        definition_digest: fingerprint(value),
    })
}

impl MetaTransport {
    async fn read_json(&self, asset: &str, edge: &str, token: &str) -> Result<Value> {
        if !valid_asset_id(asset) || !matches!(edge, "phone" | "templates") {
            bail!("invalid Meta lookup");
        }
        let path = if edge == "templates" {
            format!("{asset}/message_templates")
        } else {
            asset.to_owned()
        };
        let fields = if edge == "templates" {
            "id,name,language,status,category,components,parameter_format"
        } else {
            "id,verified_name,display_phone_number"
        };
        let mut response = self
            .http
            .get(format!(
                "https://graph.facebook.com/{}/{path}",
                self.version
            ))
            .query(&[("fields", fields), ("limit", "100")])
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("Meta lookup unavailable"))?;
        if !response.status().is_success() {
            bail!("Meta rejected the sender or template lookup");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("Meta lookup response incomplete"))?
        {
            if bytes.len() + chunk.len() > 1048576 {
                bail!("Meta lookup response exceeds its limit");
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("invalid Meta response"))
    }

    pub(crate) async fn templates(&self, waba: &str, token: &str) -> Result<Vec<Template>> {
        let value = self.read_json(waba, "templates", token).await?;
        let data = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| anyhow::anyhow!("Meta template list is unavailable"))?;
        // Bounded alpha catalogue. No arbitrary provider-supplied paging URLs.
        if value.pointer("/paging/next").is_some() || data.len() > 100 {
            bail!("sender has more than the supported 100-template catalogue");
        }
        Ok(data.iter().filter_map(supported_template).collect())
    }

    pub(crate) async fn sender_name(&self, phone: &str, token: &str) -> Result<String> {
        let value = self.read_json(phone, "phone", token).await?;
        if value.get("id").and_then(Value::as_str) != Some(phone) {
            bail!("Meta sender identity mismatch");
        }
        value
            .get("verified_name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| anyhow::anyhow!("Meta sender is not ready"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn template_rendering_is_single_pass_and_checks_parameters() {
        assert_eq!(
            render("Hello {{1}}: {{2}}", &["{{2}}".into(), "42".into()]).unwrap(),
            "Hello {{2}}: 42"
        );
        assert!(render("{{0}}", &["x".into()]).is_err());
        assert!(render("{{2}}", &["x".into()]).is_err());
    }

    #[test]
    fn only_exact_approved_body_only_utility_templates_are_admitted() {
        let mut value = json!({"id":"1","name":"invoice","language":"en",
            "status":"APPROVED","category":"UTILITY",
            "components":[{"type":"BODY","text":"Invoice {{1}}"}]});
        assert_eq!(supported_template(&value).unwrap().parameter_count, 1);
        value["status"] = json!("PAUSED");
        assert!(supported_template(&value).is_none());
        value["status"] = json!("APPROVED");
        value["components"][0]["text"] = json!("{{2}}");
        assert!(supported_template(&value).is_none());
        value["components"][0]["text"] = json!("{{1}}");
        value["category"] = json!("MARKETING");
        assert!(supported_template(&value).is_none());
    }
}
