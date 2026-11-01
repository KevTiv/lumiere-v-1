//! Owner-only edits of an existing AI allowance and agent scope.
//! Prices, credits, usage, reservations and run company attribution are not inputs.

use super::agents::{ai_agent, AiAgent};
use super::spend::{ai_spend_budget, AiSpendBudget};
use crate::core::access_lifecycle::member_is_admin;
use crate::core::organization::company;
use crate::core::permissions::{caller_delegated_company_scope, effective_roles};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use sha2::{Digest, Sha256};
use spacetimedb::{
    reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext,
};

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_owner_configuration,
    index(accessor = ai_owner_configuration_by_org, btree(columns = [organization_id])))]
pub struct AiOwnerConfiguration {
    #[primary_key]
    pub agent_id: u64,
    pub organization_id: u64,
    pub revision: u64,
    pub monthly_limit_units: u64,
    pub sponsored_ceiling_units: u64,
    pub currency: String,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(accessor = ai_owner_configuration_receipt,
    index(accessor = ai_owner_configuration_receipt_by_org, btree(columns = [organization_id])),
    index(accessor = ai_owner_configuration_receipt_by_key, btree(columns = [organization_id, request_key])))]
pub struct AiOwnerConfigurationReceipt {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub request_key: String,
    pub request_hash: String,
    pub revision: u64,
    pub kind: String,
    pub budget_id: u64,
    pub limit_units: u64,
    pub company_id: Option<u64>,
    pub actor: Identity,
    pub reason: String,
    pub created_at: Timestamp,
}

#[derive(Clone, Debug, SpacetimeType)]
pub struct SetAiOwnerLimitParams {
    pub budget_id: u64,
    pub expected_revision: u64,
    pub expected_limit_units: u64,
    pub limit_units: u64,
    pub request_key: String,
    pub reason: String,
}

#[derive(Clone, Debug, SpacetimeType)]
pub struct ShareAiOwnerAgentParams {
    pub budget_id: u64,
    pub expected_revision: u64,
    pub expected_company_id: u64,
    pub request_key: String,
    pub reason: String,
}

/// This bounded command widens one existing company agent to its organization.
/// It cannot move an agent to another organization or narrow existing run scope.
#[reducer]
pub fn share_ai_owner_agent(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    params: ShareAiOwnerAgentParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_request(&params.request_key, &params.reason)?;
    let hash = request_hash(
        ctx,
        organization_id,
        agent_id,
        "share",
        serde_json::json!({
        "budget_id":params.budget_id,"revision":params.expected_revision,
        "company_id":params.expected_company_id,"reason":params.reason}),
    );
    if replay(ctx, organization_id, agent_id, &params.request_key, &hash)? {
        return Ok(());
    }
    let (agent, budget, config) = current(ctx, organization_id, agent_id, params.budget_id)?;
    let revision = next_revision(config.revision, params.expected_revision)?;
    if agent.company_id != Some(params.expected_company_id) || params.expected_company_id == 0 {
        return Err("agent company scope changed".into());
    }
    let scope = ctx
        .db
        .company()
        .id()
        .find(params.expected_company_id)
        .filter(|c| c.organization_id == organization_id && c.deleted_at.is_none())
        .ok_or("agent company is unavailable in this organization")?;
    ctx.db.ai_agent().id().update(AiAgent {
        company_id: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..agent
    });
    persist(
        ctx,
        config,
        revision,
        &budget,
        "share",
        None,
        params.request_key,
        hash,
        params.reason,
        serde_json::json!({"company_id":scope.id}),
        serde_json::json!({"company_id":null}),
    )
}

/// Limit-only edit: modifies the exact existing current UTC period, never prices.
#[reducer]
pub fn set_ai_owner_limit(
    ctx: &ReducerContext,
    organization_id: u64,
    agent_id: u64,
    params: SetAiOwnerLimitParams,
) -> Result<(), String> {
    authorize(ctx, organization_id)?;
    validate_request(&params.request_key, &params.reason)?;
    let hash = request_hash(
        ctx,
        organization_id,
        agent_id,
        "limit",
        serde_json::json!({
        "budget_id":params.budget_id,"revision":params.expected_revision,
        "expected_limit_units":params.expected_limit_units,"limit_units":params.limit_units,
        "reason":params.reason}),
    );
    if replay(ctx, organization_id, agent_id, &params.request_key, &hash)? {
        return Ok(());
    }
    let (agent, mut budget, mut config) =
        current(ctx, organization_id, agent_id, params.budget_id)?;
    let revision = next_revision(config.revision, params.expected_revision)?;
    if budget.limit_units != params.expected_limit_units {
        return Err("budget limit changed".into());
    }
    validate_owner_ceiling(
        params.limit_units,
        config.sponsored_ceiling_units,
        super::prepaid::prepaid_enabled(ctx, organization_id, agent_id),
    )?;
    validate_limit(
        params.limit_units,
        budget.settled_units,
        budget.outstanding_units,
    )?;
    let previous = budget.limit_units;
    budget.limit_units = params.limit_units;
    budget.write_uid = ctx.sender();
    budget.write_date = ctx.timestamp;
    ctx.db.ai_spend_budget().id().update(budget.clone());
    config.monthly_limit_units = params.limit_units;
    persist(
        ctx,
        config,
        revision,
        &budget,
        "limit",
        agent.company_id,
        params.request_key,
        hash,
        params.reason,
        serde_json::json!({"limit_units":previous}),
        serde_json::json!({"limit_units":params.limit_units}),
    )
}

fn authorize(ctx: &ReducerContext, org: u64) -> Result<(), String> {
    // Human session identity must remain the reducer sender. No server/service exemption.
    check_permission(ctx, org, "ai_agent", "write")?;
    if caller_delegated_company_scope(ctx, org).is_some() {
        return Err(
            "company-delegated administrators cannot configure organization AI allowances".into(),
        );
    }
    let roles = effective_roles(ctx, org, ctx.sender())?;
    if !member_is_admin(ctx, org, ctx.sender(), &roles) {
        return Err("organization owner or administrator is required".into());
    }
    Ok(())
}

fn current(
    ctx: &ReducerContext,
    org: u64,
    agent_id: u64,
    budget_id: u64,
) -> Result<(AiAgent, AiSpendBudget, AiOwnerConfiguration), String> {
    let agent = ctx
        .db
        .ai_agent()
        .id()
        .find(agent_id)
        .filter(|a| a.organization_id == org && a.is_active)
        .ok_or("agent is unavailable")?;
    let period = current_period(ctx.timestamp)?;
    let budgets = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent_id, &period))
        .filter(|b| b.organization_id == org)
        .collect::<Vec<_>>();
    let [budget] = budgets.as_slice() else {
        return Err("exactly one current period budget is required".into());
    };
    if budget.id != budget_id {
        return Err("budget identity does not match current period".into());
    }
    // One managed pool in this foundation; two funded agents cannot simulate a shared cap.
    require_single_pool(ctx, org, agent_id)?;
    for other in ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_org()
        .filter(&org)
    {
        if other.agent_id != agent_id
            && other.billing_period == period
            && (other.settled_units > 0
                || other.outstanding_units > 0
                || (other.limit_units > 0
                    && ctx
                        .db
                        .ai_agent()
                        .id()
                        .find(other.agent_id)
                        .is_some_and(|a| a.is_active)))
        {
            return Err("multiple active agent budgets need aggregate admission".into());
        }
    }
    let config = ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent_id)
        .unwrap_or(AiOwnerConfiguration {
            agent_id,
            organization_id: org,
            revision: 0,
            monthly_limit_units: budget.limit_units,
            sponsored_ceiling_units: budget.limit_units,
            currency: budget.currency.clone(),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    if config.organization_id != org
        || config.currency != budget.currency
        || (config.revision > 0 && config.monthly_limit_units != budget.limit_units)
    {
        return Err("owner configuration and current budget differ".into());
    }
    Ok((agent, budget.clone(), config))
}

/// Preserve the single managed pool against subsequent privileged provisioning.
pub(crate) fn require_single_pool(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
) -> Result<(), String> {
    if ctx
        .db
        .ai_owner_configuration()
        .ai_owner_configuration_by_org()
        .filter(&org)
        .any(|c| c.agent_id != agent)
    {
        return Err("organization uses another managed AI pool".into());
    }
    Ok(())
}

pub(crate) fn managed_allowance(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
) -> Option<(u64, String)> {
    ctx.db
        .ai_owner_configuration()
        .agent_id()
        .find(agent)
        .filter(|c| c.organization_id == org)
        .map(|c| (c.monthly_limit_units, c.currency))
}

/// Read the exact current period without treating an owner cap as funding.
/// Prepaid-enabled renewal must be integrated with atomic funding admission.
pub(crate) fn budget_for_reservation(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
    period: &str,
    currency: &str,
) -> Result<AiSpendBudget, String> {
    if current_period(ctx.timestamp)? != period {
        return Err("reservation period is not current UTC month".into());
    }
    let rows = ctx
        .db
        .ai_spend_budget()
        .ai_spend_budget_by_agent_period()
        .filter((&agent, &period.to_string()))
        .filter(|b| b.organization_id == org)
        .collect::<Vec<_>>();
    let policy = managed_allowance(ctx, org, agent);
    match rows.as_slice() {
        [budget] => {
            if budget.currency != currency
                || policy.is_some_and(|(limit, code)| {
                    limit != budget.limit_units || code != budget.currency
                })
            {
                return Err("current period budget differs from managed allowance".into());
            }
            Ok(budget.clone())
        }
        // An owner-selected monthly cap is not sponsored funding authority.
        // Funded first-use renewal belongs to the prepaid reservation transaction.
        [] => Err("current period allowance has not been provisioned".into()),
        _ => Err("current period budget identity is not unique".into()),
    }
}

fn replay(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
    key: &str,
    hash: &str,
) -> Result<bool, String> {
    let request_key = key.to_string();
    let rows = ctx
        .db
        .ai_owner_configuration_receipt()
        .ai_owner_configuration_receipt_by_key()
        .filter((org, &request_key))
        .collect::<Vec<_>>();
    match rows.as_slice() {
        [] => Ok(false),
        [r] if r.agent_id == agent && r.actor == ctx.sender() && r.request_hash == hash => Ok(true),
        [_] => Err("request key belongs to a different configuration payload or actor".into()),
        _ => Err("configuration receipt identity is not unique".into()),
    }
}

#[allow(clippy::too_many_arguments)]
fn persist(
    ctx: &ReducerContext,
    mut config: AiOwnerConfiguration,
    revision: u64,
    budget: &AiSpendBudget,
    kind: &str,
    scope: Option<u64>,
    key: String,
    hash: String,
    reason: String,
    old: serde_json::Value,
    new: serde_json::Value,
) -> Result<(), String> {
    config.revision = revision;
    config.write_uid = ctx.sender();
    config.write_date = ctx.timestamp;
    let org = config.organization_id;
    let agent = config.agent_id;
    if ctx
        .db
        .ai_owner_configuration()
        .agent_id()
        .find(agent)
        .is_some()
    {
        ctx.db.ai_owner_configuration().agent_id().update(config);
    } else {
        ctx.db.ai_owner_configuration().insert(config);
    }
    let receipt = ctx
        .db
        .ai_owner_configuration_receipt()
        .insert(AiOwnerConfigurationReceipt {
            id: 0,
            organization_id: org,
            agent_id: agent,
            request_key: key.clone(),
            request_hash: hash,
            revision,
            kind: kind.into(),
            budget_id: budget.id,
            limit_units: budget.limit_units,
            company_id: scope,
            actor: ctx.sender(),
            reason: reason.clone(),
            created_at: ctx.timestamp,
        });
    write_audit_log_v2(
        ctx,
        org,
        AuditLogParams {
            company_id: None,
            table_name: "ai_owner_configuration",
            record_id: agent,
            action: "UPDATE",
            old_values: Some(old.to_string()),
            new_values: Some(new.to_string()),
            changed_fields: vec![kind.into(), "revision".into()],
            metadata: Some(
                serde_json::json!({"request_key":key,"receipt_id":receipt.id,
            "revision":revision,"reason":reason})
                .to_string(),
            ),
        },
    );
    Ok(())
}

fn request_hash(
    ctx: &ReducerContext,
    org: u64,
    agent: u64,
    kind: &str,
    payload: serde_json::Value,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::json!({"domain":"ai-owner-config/v1",
        "actor":ctx.sender().to_hex().to_string(),"organization":org,"agent":agent,
        "kind":kind,"payload":payload})
            .to_string()
            .as_bytes()
        )
    )
}

fn validate_request(key: &str, reason: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 200
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
    {
        return Err("request key is invalid".into());
    }
    if reason.contains('\0') {
        return Err("configuration reason contains a null byte".into());
    }
    if reason.trim().is_empty() || reason.len() > 1024 {
        return Err("configuration reason is required and bounded".into());
    }
    Ok(())
}
fn next_revision(current: u64, expected: u64) -> Result<u64, String> {
    if current != expected {
        return Err("configuration revision is stale".into());
    }
    current
        .checked_add(1)
        .ok_or_else(|| "configuration revision overflow".into())
}
/// An owner may choose a larger cap only after trusted prepaid cutover.
/// This never adds credit: reserve_ai_spend still checks the exact funded pool
/// atomically against all holds and usage before creating a reservation.
fn validate_owner_ceiling(limit: u64, ceiling: u64, prepaid: bool) -> Result<(), String> {
    if prepaid {
        Ok(())
    } else {
        validate_sponsored_limit(limit, ceiling)
    }
}

fn validate_sponsored_limit(limit: u64, ceiling: u64) -> Result<(), String> {
    if limit > ceiling {
        return Err(
            "requested cap exceeds the approved sponsored ceiling; reviewed funding is required"
                .into(),
        );
    }
    Ok(())
}
fn validate_limit(limit: u64, settled: u64, held: u64) -> Result<(), String> {
    let committed = settled
        .checked_add(held)
        .ok_or("committed spend overflow")?;
    if limit == 0 || limit < committed {
        return Err("limit must be positive and cover settled plus held spend".into());
    }
    Ok(())
}
pub(crate) fn current_period(timestamp: Timestamp) -> Result<String, String> {
    let time = chrono::DateTime::from_timestamp_micros(timestamp.to_micros_since_unix_epoch())
        .ok_or("invalid current timestamp")?;
    Ok(time.format("%Y-%m").to_string())
}

#[derive(Clone, SpacetimeType)]
pub struct AiOwnerConfigurationRead {
    pub agent_id: u64,
    pub organization_id: u64,
    pub revision: u64,
    pub monthly_limit_units: u64,
    pub sponsored_ceiling_units: u64,
    pub currency: String,
}
#[spacetimedb::view(accessor=ai_owner_configuration_read,public,primary_key=agent_id)]
pub fn ai_owner_configuration_read(ctx: &ViewContext) -> Vec<AiOwnerConfigurationRead> {
    super::spend_reads::authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_owner_configuration()
                .ai_owner_configuration_by_org()
                .filter(&org)
                .map(|c| AiOwnerConfigurationRead {
                    agent_id: c.agent_id,
                    organization_id: c.organization_id,
                    revision: c.revision,
                    monthly_limit_units: c.monthly_limit_units,
                    sponsored_ceiling_units: c.sponsored_ceiling_units,
                    currency: c.currency,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[derive(Clone, SpacetimeType)]
pub struct AiOwnerConfigurationReceiptRead {
    pub id: u64,
    pub organization_id: u64,
    pub agent_id: u64,
    pub request_key: String,
    pub request_hash: String,
    pub revision: u64,
    pub kind: String,
    pub budget_id: u64,
    pub limit_units: u64,
    pub company_id: Option<u64>,
}
#[spacetimedb::view(accessor=ai_owner_configuration_receipt_read,public,primary_key=id)]
pub fn ai_owner_configuration_receipt_read(
    ctx: &ViewContext,
) -> Vec<AiOwnerConfigurationReceiptRead> {
    super::spend_reads::authorized_organization_ids(ctx)
        .into_iter()
        .flat_map(|org| {
            ctx.db
                .ai_owner_configuration_receipt()
                .ai_owner_configuration_receipt_by_org()
                .filter(&org)
                .map(|r| AiOwnerConfigurationReceiptRead {
                    id: r.id,
                    organization_id: r.organization_id,
                    agent_id: r.agent_id,
                    request_key: r.request_key,
                    request_hash: r.request_hash,
                    revision: r.revision,
                    kind: r.kind,
                    budget_id: r.budget_id,
                    limit_units: r.limit_units,
                    company_id: r.company_id,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_trusted_prepaid_mode_separates_the_owner_cap_from_sponsorship() {
        assert!(validate_owner_ceiling(10, 5, false).is_err());
        assert!(validate_owner_ceiling(10, 5, true).is_ok());
        assert!(validate_owner_ceiling(u64::MAX, 5, false).is_err());
        // A high cap is not funding. The reservation owner independently checks
        // actual prepaid credit and the existing committed-spend floor.
        assert!(validate_owner_ceiling(u64::MAX, 5, true).is_ok());
        assert!(validate_limit(9, 6, 4).is_err());
    }

    #[test]
    fn limit_keeps_holds_and_settlement_committed() {
        assert!(validate_limit(9, 6, 4).is_err());
        assert!(validate_limit(10, 6, 4).is_ok());
        assert!(validate_limit(0, 0, 0).is_err());
        assert!(validate_limit(u64::MAX, u64::MAX, 1).is_err());
    }
    #[test]
    fn revision_rejects_stale_and_overflow() {
        assert_eq!(next_revision(2, 2), Ok(3));
        assert!(next_revision(2, 1).is_err());
        assert!(next_revision(u64::MAX, u64::MAX).is_err());
    }
    #[test]
    fn owner_cannot_mint_sponsored_allowance() {
        assert!(validate_sponsored_limit(5, 10).is_ok());
        assert!(validate_sponsored_limit(10, 10).is_ok());
        assert!(validate_sponsored_limit(10, 5).is_err());
        assert!(validate_sponsored_limit(u64::MAX, 5).is_err());
    }
    #[test]
    fn reason_rejects_null_bytes_but_allows_multiline_and_unicode_text() {
        // PostgreSQL TEXT cannot persist a null byte. Both the receipt and the
        // audit projection must remain writable after a native owner command.
        for reason in ["\0Approved", "Approved\0reason", "Approved\0"] {
            assert!(validate_request("owner-limit:null-byte", reason).is_err());
        }
        assert!(validate_request(
            "owner-limit:multiline",
            "Owner approved\nBudget for Mugisha"
        )
        .is_ok());
        assert!(validate_request("owner-limit:unicode", "Propriétaire approuvé").is_ok());
    }

    #[test]
    fn request_is_bounded() {
        assert!(validate_request("owner-limit:one", "Owner approved").is_ok());
        assert!(validate_request("../bad", "Reason").is_err());
        assert!(validate_request("good", " ").is_err());
    }
}
