/// Lead scoring — deterministic, explainable fit/engagement factors.
///
/// Tables:
///   - LeadScore
///   - LeadScoreFactor
///
/// External ML models can later append factors via workers; this reducer only
/// computes a bounded, deterministic baseline (`formula_version`).
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::crm::leads::lead;
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

pub const LEAD_SCORE_FORMULA_VERSION: &str = "v1-deterministic";

// ── Tables ───────────────────────────────────────────────────────────────────

#[spacetimedb::table(
    accessor = lead_score,
    public,
    index(accessor = lead_score_by_org, btree(columns = [organization_id])),
    index(accessor = lead_score_by_lead, btree(columns = [lead_id]))
)]
pub struct LeadScore {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub lead_id: u64,
    pub total_score: i32,
    pub formula_version: String,
    pub scored_at: Timestamp,
    pub scored_by: Identity,
    pub metadata: Option<String>,
}

#[spacetimedb::table(
    accessor = lead_score_factor,
    public,
    index(accessor = lead_score_factor_by_org, btree(columns = [organization_id])),
    index(accessor = lead_score_factor_by_lead, btree(columns = [lead_id]))
)]
pub struct LeadScoreFactor {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub lead_id: u64,
    pub score_id: u64,
    pub factor_key: String,
    pub label: String,
    pub points: i32,
    pub evidence: Option<String>,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

struct FactorDraft {
    key: &'static str,
    label: &'static str,
    points: i32,
    evidence: Option<String>,
}

fn compute_factors(lead: &crate::crm::leads::Lead) -> Vec<FactorDraft> {
    let mut factors = Vec::new();

    if lead.email.as_ref().is_some_and(|e| !e.is_empty()) {
        factors.push(FactorDraft {
            key: "has_email",
            label: "Has email",
            points: 10,
            evidence: lead.email.clone(),
        });
    }

    let phone = lead
        .phone
        .as_ref()
        .filter(|p| !p.is_empty())
        .or(lead.mobile.as_ref().filter(|p| !p.is_empty()));
    if let Some(p) = phone {
        factors.push(FactorDraft {
            key: "has_phone",
            label: "Has phone",
            points: 10,
            evidence: Some(p.clone()),
        });
    }

    if lead.company_name.as_ref().is_some_and(|c| !c.is_empty()) {
        factors.push(FactorDraft {
            key: "has_company",
            label: "Has company name",
            points: 10,
            evidence: lead.company_name.clone(),
        });
    }

    if lead.source_id.is_some() {
        factors.push(FactorDraft {
            key: "has_source",
            label: "Attributed source",
            points: 15,
            evidence: lead.source_id.map(|id| id.to_string()),
        });
    }

    if lead.website.as_ref().is_some_and(|w| !w.is_empty()) {
        factors.push(FactorDraft {
            key: "has_website",
            label: "Has website",
            points: 5,
            evidence: lead.website.clone(),
        });
    }

    if lead.industry.as_ref().is_some_and(|i| !i.is_empty()) {
        factors.push(FactorDraft {
            key: "has_industry",
            label: "Has industry",
            points: 5,
            evidence: lead.industry.clone(),
        });
    }

    let revenue_points = if lead.expected_revenue >= 100_000.0 {
        15
    } else if lead.expected_revenue >= 10_000.0 {
        10
    } else if lead.expected_revenue > 0.0 {
        5
    } else {
        0
    };
    if revenue_points > 0 {
        factors.push(FactorDraft {
            key: "expected_revenue",
            label: "Expected revenue band",
            points: revenue_points,
            evidence: Some(format!("{:.2}", lead.expected_revenue)),
        });
    }

    let probability_points = ((lead.probability.max(0.0).min(100.0)) * 0.3).round() as i32;
    if probability_points > 0 {
        factors.push(FactorDraft {
            key: "probability",
            label: "Win probability",
            points: probability_points,
            evidence: Some(format!("{:.1}", lead.probability)),
        });
    }

    if lead.state == "qualified" {
        factors.push(FactorDraft {
            key: "state_qualified",
            label: "Qualified state",
            points: 20,
            evidence: Some(lead.state.clone()),
        });
    }

    factors
}

// ── Reducers ─────────────────────────────────────────────────────────────────

/// Recompute explainable lead score factors for one lead (replaces prior score rows).
#[spacetimedb::reducer]
pub fn recompute_lead_score(
    ctx: &ReducerContext,
    organization_id: u64,
    lead_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "lead", "write")?;

    let lead_row = ctx
        .db
        .lead()
        .id()
        .find(&lead_id)
        .ok_or("Lead not found")?;
    if lead_row.organization_id != organization_id {
        return Err("Lead does not belong to this organization".to_string());
    }
    if lead_row.deleted_at.is_some() {
        return Err("Cannot score a deleted lead".to_string());
    }

    let old_score_ids: Vec<u64> = ctx
        .db
        .lead_score()
        .lead_score_by_lead()
        .filter(&lead_id)
        .filter(|s| s.organization_id == organization_id)
        .map(|s| s.id)
        .collect();
    for id in old_score_ids {
        ctx.db.lead_score().id().delete(&id);
    }

    let old_factor_ids: Vec<u64> = ctx
        .db
        .lead_score_factor()
        .lead_score_factor_by_lead()
        .filter(&lead_id)
        .filter(|f| f.organization_id == organization_id)
        .map(|f| f.id)
        .collect();
    for id in old_factor_ids {
        ctx.db.lead_score_factor().id().delete(&id);
    }

    let factors = compute_factors(&lead_row);
    let total_score: i32 = factors.iter().map(|f| f.points).sum();

    let score = ctx.db.lead_score().insert(LeadScore {
        id: 0,
        organization_id,
        lead_id,
        total_score,
        formula_version: LEAD_SCORE_FORMULA_VERSION.to_string(),
        scored_at: ctx.timestamp,
        scored_by: ctx.sender(),
        metadata: None,
    });

    for factor in &factors {
        ctx.db.lead_score_factor().insert(LeadScoreFactor {
            id: 0,
            organization_id,
            lead_id,
            score_id: score.id,
            factor_key: factor.key.to_string(),
            label: factor.label.to_string(),
            points: factor.points,
            evidence: factor.evidence.clone(),
        });
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "lead_score",
            record_id: score.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                serde_json::json!({
                    "lead_id": lead_id,
                    "total_score": total_score,
                    "formula_version": LEAD_SCORE_FORMULA_VERSION,
                    "factor_count": factors.len(),
                })
                .to_string(),
            ),
            changed_fields: vec!["total_score".to_string(), "formula_version".to_string()],
            metadata: None,
        },
    );

    Ok(())
}
