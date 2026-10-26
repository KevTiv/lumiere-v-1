//! Fixed-origin authenticated finance read; persist evidence before model use.
use crate::tools::types::{SkillCitation, ToolContext, ToolOutput};
use anyhow::{ensure, Context, Result};
use lumiere_finance_review_core::{self as core, Input};
use serde_json::{json, Value};

pub async fn fetch(
    origin: &str,
    token: &str,
    identity: &str,
    organization: u64,
    company: u64,
    key: &str,
    input: &Value,
) -> Result<Value> {
    core::parse_input(key, input)?;
    let url = reqwest::Url::parse(origin)?;
    ensure!(
        url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none(),
        "invalid finance service origin"
    );
    ensure!(
        url.scheme() == "https"
            || (url.scheme() == "http"
                && url.host_str().is_some_and(|host| host == "localhost"
                    || host == "127.0.0.1"
                    || host == "::1"
                    || host.ends_with(".railway.internal"))),
        "finance service requires HTTPS or a trusted internal origin"
    );
    ensure!(
        !token.trim().is_empty() && !identity.trim().is_empty() && organization > 0 && company > 0,
        "authenticated finance context is required"
    );
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()?;
    let mut response = client
        .post(format!(
            "{}/v1/finance-reviews/{key}",
            origin.trim_end_matches('/')
        ))
        .bearer_auth(token)
        .header("x-stdb-identity", identity)
        .json(&json!({"companyId":company,"inputs":input}))
        .send()
        .await
        .context("finance owner read unavailable")?;
    ensure!(
        response.status().is_success(),
        "finance owner read rejected: {}",
        response.status()
    );
    ensure!(
        response
            .content_length()
            .is_none_or(|length| length <= core::MAX_BYTES as u64),
        "finance response byte bound exceeded"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(
            bytes.len() + chunk.len() <= core::MAX_BYTES,
            "finance response byte bound exceeded"
        );
        bytes.extend_from_slice(&chunk);
    }
    let response: Value = serde_json::from_slice(&bytes)?;
    ensure!(
        response["schemaVersion"] == 1
            && response["skillKey"] == key
            && response["organizationId"] == organization
            && response["companyId"] == company,
        "finance owner response scope mismatch"
    );
    ensure!(
        response["observedAt"]
            .as_str()
            .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok()),
        "finance observation timestamp missing"
    );
    ensure!(
        response["observation"].is_object(),
        "finance observation missing"
    );
    match core::parse_input(key, input)? {
        Input::Bank(p) => ensure!(
            response["observation"]["statementId"] == p.statement_id,
            "wrong statement response"
        ),
        Input::Close(p) => ensure!(
            response["observation"]["periodId"] == p.period_id,
            "wrong period response"
        ),
        Input::Expense(p) => ensure!(
            response["observation"]["recordId"] == p.record_id,
            "wrong expense response"
        ),
        _ => {}
    }
    Ok(response)
}

pub fn output(
    key: &str,
    organization: u64,
    company: u64,
    run: u64,
    inputs: &Value,
    mut response: Value,
) -> Result<(ToolOutput, Value)> {
    if let Input::Variance(input) = core::parse_input(key, inputs)? {
        for (field, date) in [
            ("actual", input.actual_date),
            ("baseline", input.baseline_date),
        ] {
            let request = crate::harness::finance_review::FinanceReviewRequest {
                report_key: serde_json::from_value(serde_json::to_value(input.report_key)?)?,
                date,
                timezone: input.timezone.clone(),
            };
            crate::harness::finance_review::build_evidence(
                crate::harness::finance_review::FinanceReviewScope::new(
                    organization,
                    company,
                    run,
                )?,
                &request,
                &serde_json::to_vec(&response["observation"][field])?,
            )?;
        }
    }
    if let Input::Report(input) = core::parse_input(key, inputs)? {
        let request = crate::harness::finance_review::FinanceReviewRequest {
            report_key: serde_json::from_value(serde_json::to_value(input.report_key)?)?,
            date: input.date,
            timezone: input.timezone,
        };
        let projected = crate::harness::finance_review::build_evidence(
            crate::harness::finance_review::FinanceReviewScope::new(organization, company, run)?,
            &request,
            &serde_json::to_vec(&response["observation"])?,
        )?;
        response["observation"] = serde_json::to_value(projected.observation)?;
    }
    let passage = core::passage(key, organization, company, run, response)?;
    let citation = SkillCitation {
        kind: "finance_review_snapshot".into(),
        trust: "authoritative".into(),
        content_type: Some("application/json".into()),
        entity_id: passage["id"].as_str().map(str::to_owned),
        score: None,
        text_snippet: passage["text"].as_str().map(str::to_owned),
        label: Some(format!("{key} observed for run {run}")),
        snapshot_at: None,
        url: None,
        title: None,
        fetched_at: None,
    };
    Ok((
        ToolOutput {
            summary: format!("Authorized {key} observation"),
            data: json!({"artifacts":[{"summary":format!("Observed {key}"),"artifacts":{"evidencePassage":passage}}]}),
            citations: vec![citation],
            row_count: Some(1),
        },
        passage,
    ))
}

pub async fn execute(ctx: &ToolContext, _input: &Value) -> Result<ToolOutput> {
    let input = &ctx.inputs;
    let actor = ctx
        .actor
        .as_ref()
        .context("finance review requires actor credentials")?;
    let response = fetch(
        ctx.state
            .config
            .api_server_url
            .as_deref()
            .context("LUMIERE_API_SERVER_URL is required")?,
        &actor.stdb_token,
        &actor.identity_hex,
        ctx.org_id,
        ctx.company_id,
        &ctx.skill_key,
        input,
    )
    .await?;
    let (output, passage) = output(
        &ctx.skill_key,
        ctx.org_id,
        ctx.company_id,
        ctx.run_id,
        input,
        response,
    )?;
    super::analytics::record_snapshot(&ctx.state.stdb, ctx.org_id, ctx.company_id, &passage)
        .await?;
    Ok(output)
}
