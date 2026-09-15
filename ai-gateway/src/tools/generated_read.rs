//! Execution adapter for reviewed generated resource reads.
//!
//! Catalog review is not authorization. Each invocation is reauthorized with
//! server-resolved actor grants and then sent through the API server's existing
//! session, field-permission, organization and company checks.

use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::Value;

use super::{
    generated::{embedded_catalog, GeneratedReadGrant, PreparedGeneratedRead},
    types::{ToolContext, ToolOutput},
};
use crate::providers::llm::ToolCallRequest;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantEnvelope {
    grants: Vec<GeneratedReadGrant>,
}

pub(crate) async fn resolve_actor_grants(context: &ToolContext) -> Result<Vec<GeneratedReadGrant>> {
    let actor = context
        .actor
        .as_ref()
        .context("generated reads require actor credentials")?;
    let api_base = api_base(context)?;
    let response = context
        .state
        .http
        .get(format!("{api_base}/v1/ai/capability-grants"))
        .bearer_auth(actor.stdb_token.trim())
        .header("x-stdb-identity", actor.identity_hex.trim())
        .send()
        .await
        .context("resolve generated capability grants")?;
    if !response.status().is_success() {
        bail!(
            "generated capability grants were denied or unavailable ({})",
            response.status()
        );
    }
    let envelope: GrantEnvelope = response
        .json()
        .await
        .context("generated capability grants returned invalid JSON")?;
    Ok(envelope.grants)
}

pub(crate) struct GeneratedReadTools<'a> {
    grants: &'a [GeneratedReadGrant],
}

impl<'a> GeneratedReadTools<'a> {
    pub(crate) fn new(grants: &'a [GeneratedReadGrant]) -> Self {
        Self { grants }
    }

    pub(crate) async fn execute(
        &self,
        call: &ToolCallRequest,
        context: &ToolContext,
    ) -> Result<ToolOutput> {
        ensure!(context.run_id != 0, "durable run is required");
        let actor = context
            .actor
            .as_ref()
            .context("generated reads require actor credentials")?;
        let prepared = embedded_catalog()?
            .prepare_read(&call.name, &call.arguments, context.company_id, self.grants)
            .map_err(anyhow::Error::from)?;
        let api_base = api_base(context)?;
        let limit =
            u32::try_from(prepared.max_rows).context("generated read row limit exceeds u32")?;
        let response = context
            .state
            .http
            .get(format!("{api_base}/v1/query/{}", prepared.resource))
            .bearer_auth(actor.stdb_token.trim())
            .header("x-stdb-identity", actor.identity_hex.trim())
            .query(&[
                ("companyId", prepared.company_id),
                ("limit", u64::from(limit)),
            ])
            .send()
            .await
            .context("authorized generated read request failed")?;
        if !response.status().is_success() {
            bail!(
                "authorized generated read was denied or unavailable ({})",
                response.status()
            );
        }
        let envelope: Value = response
            .json()
            .await
            .context("authorized generated read returned invalid JSON")?;
        bounded_output(&prepared, envelope)
    }
}

fn api_base(context: &ToolContext) -> Result<&str> {
    Ok(context
        .state
        .config
        .api_server_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .context("LUMIERE_API_SERVER_URL is required for generated reads")?
        .trim_end_matches('/'))
}

fn bounded_output(prepared: &PreparedGeneratedRead, envelope: Value) -> Result<ToolOutput> {
    let rows = envelope
        .get("data")
        .and_then(Value::as_array)
        .context("authorized generated read response has no data array")?;
    ensure!(
        rows.len() as u64 <= prepared.max_rows,
        "authorized generated read exceeded its row limit"
    );
    let data = Value::Array(rows.clone());
    let bytes = serde_json::to_vec(&data).context("serialize generated read output")?;
    ensure!(
        bytes.len() as u64 <= prepared.max_bytes,
        "authorized generated read exceeded its byte limit"
    );
    let row_count = u32::try_from(rows.len()).context("generated read row count exceeds u32")?;
    Ok(ToolOutput {
        summary: format!(
            "{} returned {} authorized rows",
            prepared.capability_key, row_count
        ),
        data,
        citations: Vec::new(),
        row_count: Some(row_count),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn prepared(max_rows: u64, max_bytes: u64) -> PreparedGeneratedRead {
        PreparedGeneratedRead {
            tool_name: "inventory_products_read".into(),
            capability_key: "inventory.products.read".into(),
            resource: "products".into(),
            company_id: 7,
            max_rows,
            max_bytes,
        }
    }

    #[test]
    fn output_must_stay_inside_both_effective_caps() {
        let output = bounded_output(&prepared(2, 100), json!({"data":[{"id":1},{"id":2}]}))
            .expect("bounded output");
        assert_eq!(output.row_count, Some(2));
        assert!(bounded_output(&prepared(1, 100), json!({"data":[{"id":1},{"id":2}]})).is_err());
        assert!(bounded_output(&prepared(2, 2), json!({"data":[{"id":1}]})).is_err());
    }

    #[test]
    fn output_requires_the_authorized_query_envelope() {
        assert!(bounded_output(&prepared(1, 100), json!({"rows":[]})).is_err());
        assert!(bounded_output(&prepared(1, 100), json!({"data":{}})).is_err());
    }
}
