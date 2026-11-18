//! Private, one-shot operator command. Never a browser or gateway HTTP route.

use anyhow::{bail, ensure, Context, Result};
use lumiere_policy_core::{
    PersistentPlatformOperatorPolicy, PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY,
};
use serde_json::{json, Value};
use std::time::Duration;
use stdb_client::StdbClient;

use crate::{
    ai_agent::{ensure_allowed_action, resolve_surface_agent},
    config::Config,
    harness::entity_registry::{lookup_entity_spec, EntitySnapshotSpec, ScopeKind},
    non_llm_spend::{
        execute_metered_capped, MeteredResult, MeteredScope, MeteredUnit, SpendCap, SpendCapReached,
    },
    providers,
    rig_agent::{
        activity_fingerprint, company_reindex_activity, company_reindex_field, RigContext,
    },
};

const GRANT: &str = "embedding_reindex";
const MAX_RECORDS: usize = 100;
const MAX_PROJECTION_BYTES: usize = 128 * 1024;

struct Request {
    apply: bool,
    org: u64,
    company: u64,
    spec: &'static EntitySnapshotSpec,
    field: &'static str,
    first_id: u64,
    last_id: u64,
    currency: String,
    max_spend: u64,
}

impl Request {
    fn parse(args: impl IntoIterator<Item = String>) -> Result<Self> {
        let args = args.into_iter().collect::<Vec<_>>();
        let [mode, org, company, kind, first, last, currency, cap] = args.as_slice() else {
            bail!("usage: gateway reindex-company --check|--apply ORG COMPANY KIND FIRST_ID LAST_ID CURRENCY MAX_MICROUNITS");
        };
        let apply = match mode.as_str() {
            "--check" => false,
            "--apply" => true,
            _ => bail!("specify --check or --apply"),
        };
        let positive = |value: &str| {
            value
                .parse::<u64>()
                .ok()
                .filter(|id| *id > 0 && value == id.to_string())
                .context("reindex scope and cap require canonical positive integers")
        };
        let first_id = positive(first)?;
        let last_id = positive(last)?;
        ensure!(first_id <= last_id, "invalid reindex ID range");
        let field = company_reindex_field(kind).context("unsupported reindex record kind")?;
        let spec = lookup_entity_spec(kind).context("reindex entity is not registered")?;
        ensure!(
            currency.len() == 3 && currency.bytes().all(|c| c.is_ascii_uppercase()),
            "expected a three-letter uppercase billing currency"
        );
        let org = positive(org)?;
        let company = positive(company)?;
        ensure!(
            i64::try_from(org).is_ok() && i64::try_from(company).is_ok(),
            "scope is outside the vector index range"
        );
        Ok(Self {
            apply,
            org,
            company,
            spec,
            field,
            first_id,
            last_id,
            currency: currency.clone(),
            max_spend: positive(cap)?,
        })
    }

    fn select(&self, first: u64, last: u64) -> String {
        let scope = match self.spec.scope {
            ScopeKind::Company => format!(
                ", company_id FROM {} WHERE organization_id = {} AND company_id = {}",
                self.spec.table, self.org, self.company
            ),
            ScopeKind::Organization => format!(
                " FROM {} WHERE organization_id = {}",
                self.spec.table, self.org
            ),
            // The Option company column cannot be used as a scalar SQL filter.
            ScopeKind::OrganizationOptionalCompany => format!(
                ", company_id FROM {} WHERE organization_id = {}",
                self.spec.table, self.org
            ),
        };
        format!(
            "SELECT id, organization_id, {}{scope} AND id >= {first} AND id <= {last}",
            self.field
        )
    }

    fn row_is_in_scope(&self, row: &Value) -> bool {
        if uint(row.get("organizationId")) != Some(self.org) {
            return false;
        }
        match self.spec.scope {
            ScopeKind::Company => uint(row.get("companyId")) == Some(self.company),
            ScopeKind::Organization => true,
            ScopeKind::OrganizationOptionalCompany => row
                .get("companyId")
                .is_some_and(|value| value.is_null() || uint(Some(value)) == Some(self.company)),
        }
    }
}

fn uint(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

struct Operator {
    stdb: StdbClient,
    policy: PersistentPlatformOperatorPolicy,
}

#[derive(Clone, Copy)]
struct Bounds {
    rows: usize,
    bytes: usize,
}

impl Operator {
    async fn authorize(&self) -> Result<Bounds> {
        let policy = &self.policy;
        let identity = &policy.identity_hex;
        let org = policy.organization_id;
        ensure!(
            self.stdb.authenticated_identity().await? == *identity,
            "operator token identity mismatch"
        );
        let read = self.stdb.with_query_limits(1, 16 * 1024)?;
        let profile = read.query_sql(&format!(
            "SELECT organization_id, is_active, is_superuser, metadata FROM user_profile WHERE identity = 0x{identity}"
        )).await?;
        let membership = read.query_sql(&format!(
            "SELECT organization_id, company_id, role_id, is_active, metadata FROM user_organization WHERE user_identity = 0x{identity}"
        )).await?;
        let ([profile], [membership]) = (profile.as_slice(), membership.as_slice()) else {
            bail!("operator enrollment bindings unavailable");
        };
        let role_id = current_operator_role(policy, profile, membership)
            .context("operator not currently enrolled")?;
        let roles = read.query_sql(&format!(
            "SELECT id FROM role WHERE organization_id = {org} AND id = {role_id} AND is_active = true"
        )).await?;
        ensure!(roles.len() == 1, "operator role not currently active");
        let grants = read.query_sql(&format!(
            "SELECT max_rows, max_bytes FROM ai_capability_role_grant \
             WHERE organization_id = {org} AND role_id = {role_id} AND capability_key = '{GRANT}' AND is_active = true"
        )).await?;
        let [grant] = grants.as_slice() else {
            bail!("operator requires an explicit embedding_reindex grant");
        };
        let rows = uint(grant.get("maxRows")).context("invalid reindex grant row bound")?;
        let bytes = uint(grant.get("maxBytes")).context("invalid reindex grant byte bound")?;
        ensure!(rows > 0 && bytes > 0, "empty reindex grant");
        Ok(Bounds {
            rows: rows.min(MAX_RECORDS as u64) as usize,
            bytes: bytes.min(MAX_PROJECTION_BYTES as u64) as usize,
        })
    }

    async fn candidates(&self, req: &Request, bounds: Bounds) -> Result<Vec<Value>> {
        self.require_target(req).await?;
        let client = self.stdb.with_query_limits(bounds.rows, bounds.bytes)?;
        // Fail on overflow rather than silently picking an unordered LIMIT
        // prefix. The operator can split the explicit ID interval and retry.
        let mut rows = client
            .query_sql(&req.select(req.first_id, req.last_id))
            .await?;
        rows.retain(|row| req.row_is_in_scope(row));
        rows.sort_by_key(|row| uint(row.get("id")));
        Ok(rows)
    }

    async fn require_target(&self, req: &Request) -> Result<()> {
        let client = self.stdb.with_query_limits(1, 8 * 1024)?;
        let organization = client.query_sql(&format!(
            "SELECT id FROM organization WHERE id = {} AND organization_id = {} AND is_active = true LIMIT 1",
            req.org, req.org,
        )).await?;
        let company = client
            .query_sql(&format!(
                "SELECT id, deleted_at FROM company WHERE id = {} AND organization_id = {} LIMIT 1",
                req.company, req.org,
            ))
            .await?;
        ensure!(
            organization.len() == 1
                && company.len() == 1
                && company[0].get("deletedAt").is_some_and(Value::is_null),
            "target company is not active in the requested organization"
        );
        Ok(())
    }

    async fn read_current(&self, req: &Request, bounds: Bounds, id: u64) -> Result<Option<Value>> {
        let current = self.authorize().await?;
        ensure!(
            bounds.rows <= current.rows && bounds.bytes <= current.bytes,
            "operator grant narrowed"
        );
        self.require_target(req).await?;
        let mut rows = self
            .stdb
            .with_query_limits(1, current.bytes)?
            .query_sql(&req.select(id, id))
            .await?;
        Ok(rows
            .pop()
            .filter(|row| req.row_is_in_scope(row) && uint(row.get("id")) == Some(id)))
    }
}

fn current_operator_role(
    policy: &PersistentPlatformOperatorPolicy,
    profile: &Value,
    membership: &Value,
) -> Option<u64> {
    let raw = profile.get("metadata")?.as_str()?;
    if membership.get("metadata")?.as_str()? != raw
        || profile.get("isActive")?.as_bool() != Some(true)
        || profile.get("isSuperuser")?.as_bool() != Some(true)
        || membership.get("isActive")?.as_bool() != Some(true)
        || uint(profile.get("organizationId")) != Some(policy.organization_id)
        || uint(membership.get("organizationId")) != Some(policy.organization_id)
        || uint(membership.get("companyId")) != Some(policy.company_id)
    {
        return None;
    }
    let meta: Value = serde_json::from_str(raw).ok()?;
    let enrolled = meta.get(PERSISTENT_PLATFORM_OPERATOR_METADATA_KEY)?;
    if enrolled.get("identityHex")?.as_str()? != policy.identity_hex
        || uint(enrolled.get("organizationId")) != Some(policy.organization_id)
        || uint(enrolled.get("companyId")) != Some(policy.company_id)
        || enrolled.get("approvalRef")?.as_str()? != policy.approval_ref
        || uint(enrolled.get("enrolledAtMicros"))? == 0
    {
        return None;
    }
    uint(membership.get("roleId")).filter(|id| *id > 0)
}

fn private_origin(host: &str) -> Result<()> {
    let url = reqwest::Url::parse(host)?;
    ensure!(
        url.scheme() == "http"
            && url.host_str().is_some_and(|host| {
                host.ends_with(".railway.internal")
                    || matches!(host, "localhost" | "127.0.0.1" | "[::1]")
            })
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "reindex requires a private or loopback SpacetimeDB origin"
    );
    Ok(())
}

pub(crate) async fn run_from_env(args: impl IntoIterator<Item = String>) -> Result<()> {
    let req = Request::parse(args)?;
    let config = Config::from_env()
        .map_err(|_| anyhow::anyhow!("reindex gateway configuration unavailable"))?;
    private_origin(&config.stdb_host).map_err(|_| {
        anyhow::anyhow!("reindex requires a private or loopback SpacetimeDB origin")
    })?;
    let raw_policy = std::env::var("LUMIERE_PERSISTENT_PLATFORM_OPERATOR")
        .context("operator policy required")?;
    let policy = PersistentPlatformOperatorPolicy::parse(&raw_policy)
        .map_err(|_| anyhow::anyhow!("invalid persistent operator policy"))?;
    let operator_token = std::env::var("AI_REINDEX_OPERATOR_STDB_TOKEN")
        .ok()
        .filter(|token| !token.trim().is_empty())
        .context("AI_REINDEX_OPERATOR_STDB_TOKEN required in the private command environment")?;
    let reader_token = config
        .ai_spend_read_stdb_token
        .as_deref()
        .context("spend reader required")?;
    ensure!(
        operator_token != config.stdb_token && operator_token != reader_token,
        "operator, spend writer and reader must be distinct"
    );
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()?;
    let client = |token: &str| {
        StdbClient::new(
            config.stdb_host.clone(),
            config.stdb_module.clone(),
            token.into(),
        )
        .with_http_client(http.clone())
    };
    let operator = Operator {
        stdb: client(&operator_token),
        policy,
    };
    let writer = client(&config.stdb_token);
    let reader = client(reader_token);
    // Do not include SQL, provider, or record values in an operator report.
    run(&req, &config, &operator, &writer, &reader, http).await
}

async fn run(
    req: &Request,
    config: &Config,
    operator: &Operator,
    writer: &StdbClient,
    reader: &StdbClient,
    http: reqwest::Client,
) -> Result<()> {
    let bounds = operator.authorize().await.map_err(|_| {
        anyhow::anyhow!("current persistent operator or embedding_reindex grant unavailable")
    })?;
    if req.apply {
        // Exact sender and policy are independently checked by the compiled
        // module. The existing false/check path never applies enrollment.
        let probe = stdb_client::ReducerCall::from_name(
            "enroll_persistent_platform_operator",
            json!([false]),
        )?;
        operator
            .stdb
            .call_reducer(probe)
            .await
            .map_err(|_| anyhow::anyhow!("compiled operator authority unavailable"))?;
    }
    let candidates = operator.candidates(req, bounds).await
        .map_err(|_| anyhow::anyhow!("could not read scoped ID range; verify company or split the range to fit row and byte limits"))?;
    if !req.apply {
        println!(
            "{}",
            json!({"mode":"check","candidates":candidates.len(),"maxMicrounits":req.max_spend,"currency":req.currency})
        );
        return Ok(());
    }
    ensure!(
        config.embedding_provider == "mistral",
        "reindex requires the admitted Mistral embedding path"
    );
    let providers = providers::build(config, http)
        .map_err(|_| anyhow::anyhow!("reindex provider configuration unavailable"))?;
    let rig = RigContext::new(config, providers.clone())
        .await
        .map_err(|_| anyhow::anyhow!("reindex vector configuration unavailable"))?;
    rig.check_ready()
        .await
        .map_err(|_| anyhow::anyhow!("activity index unavailable"))?;
    let cap = SpendCap::new(req.currency.clone(), req.max_spend);
    let mut indexed = 0;
    let mut skipped = 0;
    let mut cap_reached = false;
    let mut projected_bytes = 0usize;
    for row in &candidates {
        let id = uint(row.get("id"))
            .filter(|id| (req.first_id..=req.last_id).contains(id))
            .context("invalid canonical reindex identity")?;
        let fresh = operator.read_current(req, bounds, id).await.map_err(|_| {
            anyhow::anyhow!("current operator authorization or reindex row unavailable")
        })?;
        let Some(activity) = fresh.as_ref().and_then(|row| {
            company_reindex_activity(req.org, req.company, req.spec.entity_type, id, row)
        }) else {
            skipped += 1;
            continue;
        };
        if rig
            .activity_is_current(&activity)
            .await
            .map_err(|_| anyhow::anyhow!("activity index read failed"))?
        {
            skipped += 1;
            continue;
        }
        projected_bytes = projected_bytes.saturating_add(activity.text.len());
        ensure!(
            projected_bytes <= bounds.bytes,
            "reindex input exceeds its byte grant; split the ID range"
        );
        let agent = resolve_surface_agent(
            writer,
            req.org,
            req.company,
            "activity_indexing",
            None,
            None,
            config.ollama_supports_tool_calling,
        )
        .await
        .map_err(|_| anyhow::anyhow!("activity indexing agent unavailable"))?;
        ensure_allowed_action(&agent, "embedding_index")
            .map_err(|_| anyhow::anyhow!("activity indexing action not permitted"))?;
        let fingerprint = activity_fingerprint(&activity);
        let model = config.embedding_model_name();
        let scope = MeteredScope {
            organization_id: req.org,
            company_id: req.company,
            agent_id: agent.agent_id,
            run_id: 0,
            actor_identity: operator.policy.identity_hex.clone(),
            // Stable across repeated runs against the same projection. The
            // operator and exact model bind the key separately from the point.
            request_key: super::routes::context::request_digest(
                "reindex",
                req.org,
                req.company,
                &operator.policy.identity_hex,
                &model,
                fingerprint.as_bytes(),
            ),
            model,
            unit: MeteredUnit::Tokens,
            allowance: u32::try_from(activity.text.len() + 128)?,
        };
        let vector = match execute_metered_capped(writer, reader, scope, &cap, || async {
            let result = providers
                .embedder
                .embed_batch_with_usage(std::slice::from_ref(&activity.text))
                .await?;
            let units = result.input_tokens.context("missing embedding usage")?;
            let mut vectors = result.vectors.into_iter();
            let vector = vectors.next().context("missing embedding vector")?;
            ensure!(vectors.next().is_none(), "unexpected embedding count");
            Ok(MeteredResult {
                value: vector,
                units,
            })
        })
        .await
        {
            Ok(vector) => vector,
            Err(error) if error.is::<SpendCapReached>() => {
                cap_reached = true;
                break;
            }
            Err(_) => bail!("reindex metering stopped; inspect native ledger before retrying"),
        };
        let fresh = operator.read_current(req, bounds, id).await.map_err(|_| {
            anyhow::anyhow!("operator authorization or reindex publication readback unavailable")
        })?;
        if let Some(row) = fresh {
            if company_reindex_activity(req.org, req.company, req.spec.entity_type, id, &row)
                .is_some_and(|fresh| activity_fingerprint(&fresh) == fingerprint)
            {
                rig.upsert_activities_with_vectors(&[activity], vec![vector])
                    .await
                    .map_err(|_| anyhow::anyhow!("reindex vector publication unavailable"))?;
                indexed += 1;
                continue;
            }
        }
        skipped += 1;
    }
    println!(
        "{}",
        json!({"mode":"apply","candidates":candidates.len(),"indexed":indexed,"skipped":skipped,
        "capReached":cap_reached,"admittedMicrounits":req.max_spend - cap.remaining(),"currency":req.currency})
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(kind: &str) -> Result<Request> {
        Request::parse(["--check", "7", "11", kind, "1", "100", "USD", "500"].map(str::to_owned))
    }

    #[test]
    fn id_window_and_columns_are_server_owned() {
        let req = parse("sale_order").unwrap();
        assert_eq!(
            req.select(req.first_id, req.last_id),
            "SELECT id, organization_id, reference, company_id FROM sale_order \
             WHERE organization_id = 7 AND company_id = 11 AND id >= 1 AND id <= 100"
        );
        assert!(!req.apply);
        assert!(parse("sale_order; SELECT * FROM contact").is_err());
        assert!(parse("module_backfill_record").is_err());
        for args in [
            ["--apply", "7", "11", "sale_order", "100", "1", "USD", "500"],
            ["--apply", "7", "11", "sale_order", "1", "100", "USD", "0"],
            ["--apply", "7", "11", "sale_order", "1", "100", "usd", "500"],
        ] {
            assert!(Request::parse(args.map(str::to_owned)).is_err());
        }
    }

    #[test]
    fn optional_company_does_not_admit_other_company_or_missing_scope() {
        let req = parse("contact").unwrap();
        for company in [json!(11), Value::Null] {
            assert!(req.row_is_in_scope(&json!({"organizationId":7,"companyId":company})));
        }
        for row in [
            json!({"organizationId":7,"companyId":12}),
            json!({"organizationId":8,"companyId":11}),
            json!({"organizationId":7}),
            json!({"companyId":11}),
        ] {
            assert!(!req.row_is_in_scope(&row));
        }
    }

    #[test]
    fn persisted_operator_and_membership_must_both_be_current() {
        let id = "ab".repeat(32);
        let policy =
            PersistentPlatformOperatorPolicy::parse(&format!("{id}:1:2:test-approval")).unwrap();
        let metadata = json!({"persistent_platform_operator_v1":{
            "identityHex":id,"organizationId":1,"companyId":2,
            "approvalRef":"test-approval","enrolledAtMicros":123
        }})
        .to_string();
        let profile =
            json!({"organizationId":1,"isActive":true,"isSuperuser":true,"metadata":metadata});
        let membership = json!({"organizationId":1,"companyId":2,"roleId":3,"isActive":true,"metadata":metadata});
        assert_eq!(
            current_operator_role(&policy, &profile, &membership),
            Some(3)
        );
        let mut revoked = membership.clone();
        revoked["isActive"] = json!(false);
        assert_eq!(current_operator_role(&policy, &profile, &revoked), None);
        let mut mismatched = profile.clone();
        mismatched["metadata"] = json!("another enrollment");
        assert_eq!(
            current_operator_role(&policy, &mismatched, &membership),
            None
        );
        let mut unprivileged = profile.clone();
        unprivileged["isSuperuser"] = json!(false);
        assert_eq!(
            current_operator_role(&policy, &unprivileged, &membership),
            None
        );
    }

    #[test]
    fn operator_token_can_only_go_to_the_private_origin() {
        for url in [
            "http://spacetimedb.railway.internal:3000",
            "http://127.0.0.1:3000",
        ] {
            assert!(private_origin(url).is_ok());
        }
        for url in [
            "https://example.test",
            "http://spacetimedb.railway.internal.example.test",
            "http://127.0.0.1:3000/database",
            "http://user@localhost",
        ] {
            assert!(private_origin(url).is_err());
        }
    }
}
