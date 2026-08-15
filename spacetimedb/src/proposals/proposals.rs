//! Proposals & Tenders — collaborative drafts, versions, bid decisions, convert.
//!
//! # Tables
//! | Table | Description |
//! |-------|-------------|
//! | **Proposal** | Header (company, currency, status, commercial total, convert FKs) |
//! | **ProposalSection** | Draft sections with optimistic `revision` |
//! | **ProposalVersion** | Server-authored snapshots |
//! | **ProposalSourceDoc** | Source documents for AI analysis |
//! | **ProposalLineItem** | ERP products/services linked to sections |
//! | **ProposalPresence** | Real-time collaborative presence |
//! | **ProposalComment** | Threaded comments per section |
//! | **ProposalBidDecision** | Bid / no-bid decision with rationale |

use serde_json::json;
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::crm::contacts::{contact, Contact};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};
use crate::inventory::product::product;
use crate::projects::projects::{create_project, project_project, CreateProjectParams};
use crate::sales::sales_core::{
    create_sale_order, sale_order, CreateSaleOrderLineParams, CreateSaleOrderParams,
};

const MAX_SOURCE_DOC_CHARS: usize = 100_000;

// ============================================================================
// ENUMS
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Draft,
    Review,
    Submitted,
    Awarded,
    Rejected,
    Archived,
}

impl ProposalStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "draft" => Ok(Self::Draft),
            "review" => Ok(Self::Review),
            "submitted" => Ok(Self::Submitted),
            "awarded" => Ok(Self::Awarded),
            "rejected" => Ok(Self::Rejected),
            "archived" => Ok(Self::Archived),
            other => Err(format!(
                "Invalid proposal status '{}'. Valid: draft, review, submitted, awarded, rejected, archived",
                other
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Review => "review",
            Self::Submitted => "submitted",
            Self::Awarded => "awarded",
            Self::Rejected => "rejected",
            Self::Archived => "archived",
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum SectionStatus {
    Empty,
    Draft,
    Complete,
    Reviewed,
}

impl SectionStatus {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "empty" => Ok(Self::Empty),
            "draft" => Ok(Self::Draft),
            "complete" => Ok(Self::Complete),
            "reviewed" => Ok(Self::Reviewed),
            other => Err(format!(
                "Invalid section status '{}'. Valid: empty, draft, complete, reviewed",
                other
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Draft => "draft",
            Self::Complete => "complete",
            Self::Reviewed => "reviewed",
        }
    }
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum BidDecisionKind {
    Undecided,
    Bid,
    NoBid,
}

impl BidDecisionKind {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "undecided" => Ok(Self::Undecided),
            "bid" => Ok(Self::Bid),
            "no_bid" | "nobid" => Ok(Self::NoBid),
            other => Err(format!(
                "Invalid bid decision '{}'. Valid: undecided, bid, no_bid",
                other
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Undecided => "undecided",
            Self::Bid => "bid",
            Self::NoBid => "no_bid",
        }
    }
}

// ============================================================================
// TABLES
// ============================================================================

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal,
    public,
    index(accessor = proposal_by_org, btree(columns = [organization_id])),
    index(accessor = proposal_by_company, btree(columns = [company_id])),
    index(accessor = proposal_by_status, btree(columns = [status]))
)]
pub struct Proposal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub currency_id: u64,
    pub title: String,
    pub client_name: String,
    pub status: ProposalStatus,
    /// Commercial total — recomputed from line items when lines exist.
    pub value: f64,
    pub deadline: Option<Timestamp>,
    pub description: Option<String>,
    pub owner_id: Identity,
    pub version_count: u32,
    pub template_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub document_folder_id: Option<u64>,
    /// Set by `approve_proposal` while Submitted; required before Awarded.
    pub award_approved_at: Option<Timestamp>,
    pub award_approved_by: Option<Identity>,
    pub sale_order_id: Option<u64>,
    pub project_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_section,
    public,
    index(accessor = proposal_section_by_proposal, btree(columns = [proposal_id])),
    index(accessor = proposal_section_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalSection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub title: String,
    pub content: String,
    pub status: SectionStatus,
    pub ai_suggestion: Option<String>,
    pub sequence: u32,
    pub word_count: u32,
    /// Optimistic concurrency token — bump on every successful write.
    pub revision: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_version,
    public,
    index(accessor = proposal_version_by_proposal, btree(columns = [proposal_id])),
    index(accessor = proposal_version_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalVersion {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub version_number: u32,
    pub message: String,
    /// Server-authored JSON: `{ sections, line_items, value, currency_id }`.
    pub sections_json: String,
    pub author_id: Identity,
    pub create_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_source_doc,
    public,
    index(accessor = proposal_source_by_proposal, btree(columns = [proposal_id])),
    index(accessor = proposal_source_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalSourceDoc {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub name: String,
    pub content: String,
    pub doc_type: String,
    pub word_count: u32,
    pub document_id: Option<u64>,
    pub added_by: Identity,
    pub added_at: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_line_item,
    public,
    index(accessor = line_item_by_proposal, btree(columns = [proposal_id])),
    index(accessor = line_item_by_section, btree(columns = [section_id]))
)]
pub struct ProposalLineItem {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub section_id: Option<u64>,
    pub product_id: u64,
    pub product_name: String,
    pub product_variant_id: Option<u64>,
    pub description: Option<String>,
    pub quantity: f64,
    pub price_unit: f64,
    pub subtotal: f64,
    pub discount: f64,
    pub sequence: u32,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_presence,
    public,
    index(accessor = presence_by_proposal, btree(columns = [proposal_id])),
    index(accessor = presence_by_user, btree(columns = [user_id]))
)]
pub struct ProposalPresence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub section_id: Option<u64>,
    pub user_id: Identity,
    pub user_name: String,
    pub cursor_position: Option<u32>,
    pub last_seen: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_comment,
    public,
    index(accessor = comment_by_proposal, btree(columns = [proposal_id])),
    index(accessor = comment_by_section, btree(columns = [section_id]))
)]
pub struct ProposalComment {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub proposal_id: u64,
    pub section_id: u64,
    pub author_id: Identity,
    pub author_name: String,
    pub content: String,
    pub parent_id: Option<u64>,
    pub is_resolved: bool,
    pub resolved_by: Option<Identity>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_bid_decision,
    public,
    index(accessor = bid_decision_by_proposal, btree(columns = [proposal_id])),
    index(accessor = bid_decision_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalBidDecision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub decision: BidDecisionKind,
    pub rationale: String,
    pub decided_by: Identity,
    pub decided_at: Timestamp,
}

// ── Input Params ─────────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProposalParams {
    pub title: String,
    pub client_name: String,
    pub currency_id: u64,
    pub value: f64,
    pub deadline: Option<Timestamp>,
    pub description: Option<String>,
    pub template_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub document_folder_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProposalParams {
    pub title: Option<String>,
    pub client_name: Option<String>,
    pub currency_id: Option<u64>,
    pub value: Option<f64>,
    pub deadline: Option<Timestamp>,
    pub description: Option<String>,
    pub template_id: Option<u64>,
    pub partner_id: Option<u64>,
    pub document_folder_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertProposalSectionParams {
    pub title: String,
    pub content: String,
    pub status: String,
    pub sequence: u32,
    pub ai_suggestion: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AddProposalLineItemParams {
    pub section_id: Option<u64>,
    pub product_id: u64,
    pub product_name: String,
    pub product_variant_id: Option<u64>,
    pub description: Option<String>,
    pub quantity: f64,
    pub price_unit: f64,
    pub discount: f64,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProposalLineItemParams {
    pub quantity: Option<f64>,
    pub price_unit: Option<f64>,
    pub discount: Option<f64>,
    pub notes: Option<String>,
    pub description: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProposalSourceDocParams {
    pub name: Option<String>,
    pub content: Option<String>,
    pub doc_type: Option<String>,
    pub word_count: Option<u32>,
    pub document_id: Option<u64>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct RecordProposalBidDecisionParams {
    pub decision: String,
    pub rationale: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertProposalToSaleOrderParams {
    pub warehouse_id: u64,
    pub pricelist_id: u64,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ConvertProposalToProjectParams {
    pub bill_type: String,
    pub pricing_type: String,
}

// ============================================================================
// HELPERS
// ============================================================================

pub(crate) fn load_proposal_scoped(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
) -> Result<Proposal, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;
    if proposal.organization_id != organization_id {
        return Err("Proposal does not belong to this organization".to_string());
    }
    if proposal.company_id != company_id {
        return Err("Proposal does not belong to this company".to_string());
    }
    Ok(proposal)
}

fn line_subtotal(quantity: f64, price_unit: f64, discount: f64) -> f64 {
    quantity * price_unit * (1.0 - discount / 100.0)
}

fn recompute_proposal_value(ctx: &ReducerContext, proposal: Proposal) -> Proposal {
    let mut total = 0.0;
    let mut has_lines = false;
    for item in ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal.id)
    {
        has_lines = true;
        total += item.subtotal;
    }
    let value = if has_lines { total } else { proposal.value };
    let updated = Proposal {
        value,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    };
    ctx.db.proposal().id().update(updated.clone());
    updated
}

fn validate_status_transition(
    ctx: &ReducerContext,
    proposal: &Proposal,
    from: &ProposalStatus,
    to: &ProposalStatus,
) -> Result<(), String> {
    let allowed = matches!(
        (from, to),
        (ProposalStatus::Draft, ProposalStatus::Review)
            | (ProposalStatus::Draft, ProposalStatus::Archived)
            | (ProposalStatus::Review, ProposalStatus::Draft)
            | (ProposalStatus::Review, ProposalStatus::Submitted)
            | (ProposalStatus::Review, ProposalStatus::Rejected)
            | (ProposalStatus::Submitted, ProposalStatus::Review)
            | (ProposalStatus::Submitted, ProposalStatus::Awarded)
            | (ProposalStatus::Submitted, ProposalStatus::Rejected)
            | (ProposalStatus::Awarded, ProposalStatus::Archived)
            | (ProposalStatus::Rejected, ProposalStatus::Archived)
            | (ProposalStatus::Rejected, ProposalStatus::Draft)
    );
    if !allowed {
        return Err(format!(
            "Invalid status transition {} → {}",
            from.as_str(),
            to.as_str()
        ));
    }

    if *to == ProposalStatus::Submitted {
        let decision = ctx
            .db
            .proposal_bid_decision()
            .bid_decision_by_proposal()
            .filter(&proposal.id)
            .max_by_key(|d| d.id);
        match decision.map(|d| d.decision) {
            Some(BidDecisionKind::Bid) => {}
            Some(BidDecisionKind::NoBid) => {
                return Err("Cannot submit proposal after a no-bid decision".to_string());
            }
            Some(BidDecisionKind::Undecided) | None => {
                return Err("Record a bid decision before submitting".to_string());
            }
        }
        assert_compliance_ready_for_submit(ctx, proposal.id)?;
    }

    if *to == ProposalStatus::Awarded && proposal.award_approved_at.is_none() {
        return Err("Proposal must be approved for award before Awarded status".to_string());
    }

    Ok(())
}

fn build_server_snapshot(ctx: &ReducerContext, proposal: &Proposal) -> String {
    let sections: Vec<_> = ctx
        .db
        .proposal_section()
        .proposal_section_by_proposal()
        .filter(&proposal.id)
        .map(|s| {
            json!({
                "id": s.id,
                "title": s.title,
                "content": s.content,
                "status": s.status.as_str(),
                "sequence": s.sequence,
                "word_count": s.word_count,
                "revision": s.revision,
                "ai_suggestion": s.ai_suggestion,
            })
        })
        .collect();
    let line_items: Vec<_> = ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal.id)
        .map(|l| {
            json!({
                "id": l.id,
                "section_id": l.section_id,
                "product_id": l.product_id,
                "product_name": l.product_name,
                "quantity": l.quantity,
                "price_unit": l.price_unit,
                "discount": l.discount,
                "subtotal": l.subtotal,
                "sequence": l.sequence,
                "notes": l.notes,
                "description": l.description,
            })
        })
        .collect();
    json!({
        "sections": sections,
        "line_items": line_items,
        "value": proposal.value,
        "currency_id": proposal.currency_id,
        "company_id": proposal.company_id,
    })
    .to_string()
}

fn ensure_source_doc_size(content: &str) -> Result<(), String> {
    if content.len() > MAX_SOURCE_DOC_CHARS {
        return Err(format!(
            "Source document content exceeds {} characters — store large files in documents and pass document_id",
            MAX_SOURCE_DOC_CHARS
        ));
    }
    Ok(())
}

fn touch_proposal(ctx: &ReducerContext, proposal: Proposal) {
    ctx.db.proposal().id().update(Proposal {
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });
}

/// Blocks submit when any required compliance row is incomplete (waived rows OK).
fn assert_compliance_ready_for_submit(
    ctx: &ReducerContext,
    proposal_id: u64,
) -> Result<(), String> {
    let incomplete: Vec<String> = ctx
        .db
        .proposal_compliance_requirement()
        .compliance_by_proposal()
        .filter(&proposal_id)
        .filter(|r| r.is_required && !r.is_complete && !r.is_waived)
        .map(|r| r.requirement_key.clone())
        .collect();
    if incomplete.is_empty() {
        return Ok(());
    }
    Err(format!(
        "Compliance incomplete before submit: {}",
        incomplete.join(", ")
    ))
}

// ============================================================================
// REDUCERS
// ============================================================================

#[reducer]
pub fn create_proposal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProposalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "create")?;
    require_company_in_organization(ctx, organization_id, company_id)?;

    if params.title.trim().is_empty() {
        return Err("Title cannot be empty".to_string());
    }
    if params.currency_id == 0 {
        return Err("currency_id is required".to_string());
    }

    let row = ctx.db.proposal().insert(Proposal {
        id: 0,
        organization_id,
        company_id,
        currency_id: params.currency_id,
        title: params.title.clone(),
        client_name: params.client_name,
        status: ProposalStatus::Draft,
        value: params.value,
        deadline: params.deadline,
        description: params.description,
        owner_id: ctx.sender(),
        version_count: 0,
        template_id: params.template_id,
        partner_id: params.partner_id,
        document_folder_id: params.document_folder_id,
        award_approved_at: None,
        award_approved_by: None,
        sale_order_id: None,
        project_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({
                    "title": row.title,
                    "company_id": company_id,
                    "currency_id": row.currency_id,
                    "value": row.value,
                })
                .to_string(),
            ),
            changed_fields: vec![
                "title".into(),
                "company_id".into(),
                "currency_id".into(),
                "value".into(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_proposal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: UpdateProposalParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    let old = json!({
        "title": proposal.title,
        "client_name": proposal.client_name,
        "value": proposal.value,
        "currency_id": proposal.currency_id,
    })
    .to_string();

    let mut changed = Vec::new();
    let title = if let Some(t) = params.title {
        changed.push("title".into());
        t
    } else {
        proposal.title.clone()
    };
    let client_name = if let Some(c) = params.client_name {
        changed.push("client_name".into());
        c
    } else {
        proposal.client_name.clone()
    };
    let currency_id = if let Some(c) = params.currency_id {
        if c == 0 {
            return Err("currency_id is required".to_string());
        }
        changed.push("currency_id".into());
        c
    } else {
        proposal.currency_id
    };
    // Manual value only when no line items (lines own the total).
    let has_lines = ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal_id)
        .next()
        .is_some();
    let value = if let Some(v) = params.value {
        if has_lines {
            proposal.value
        } else {
            changed.push("value".into());
            v
        }
    } else {
        proposal.value
    };
    let deadline = if params.deadline.is_some() {
        changed.push("deadline".into());
        params.deadline
    } else {
        proposal.deadline
    };
    let description = if params.description.is_some() {
        changed.push("description".into());
        params.description
    } else {
        proposal.description.clone()
    };
    let template_id = if params.template_id.is_some() {
        changed.push("template_id".into());
        params.template_id
    } else {
        proposal.template_id
    };
    let partner_id = if params.partner_id.is_some() {
        changed.push("partner_id".into());
        params.partner_id
    } else {
        proposal.partner_id
    };
    let document_folder_id = if params.document_folder_id.is_some() {
        changed.push("document_folder_id".into());
        params.document_folder_id
    } else {
        proposal.document_folder_id
    };
    let metadata = if params.metadata.is_some() {
        changed.push("metadata".into());
        params.metadata
    } else {
        proposal.metadata.clone()
    };

    let updated = Proposal {
        title,
        client_name,
        currency_id,
        value,
        deadline,
        description,
        template_id,
        partner_id,
        document_folder_id,
        metadata,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    };
    ctx.db.proposal().id().update(updated.clone());

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: Some(old),
            new_values: Some(
                json!({
                    "title": updated.title,
                    "client_name": updated.client_name,
                    "value": updated.value,
                    "currency_id": updated.currency_id,
                })
                .to_string(),
            ),
            changed_fields: changed,
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_proposal_status(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    status: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let new_status = ProposalStatus::from_str(&status)?;
    validate_status_transition(ctx, &proposal, &proposal.status, &new_status)?;

    let old_status = proposal.status.as_str().to_string();
    // Clear award approval when leaving Submitted without awarding.
    let clear_approval = new_status != ProposalStatus::Awarded
        && new_status != ProposalStatus::Submitted
        && proposal.award_approved_at.is_some();

    ctx.db.proposal().id().update(Proposal {
        status: new_status.clone(),
        award_approved_at: if clear_approval {
            None
        } else {
            proposal.award_approved_at
        },
        award_approved_by: if clear_approval {
            None
        } else {
            proposal.award_approved_by
        },
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: Some(json!({ "status": old_status }).to_string()),
            new_values: Some(json!({ "status": new_status.as_str() }).to_string()),
            changed_fields: vec!["status".into()],
            metadata: None,
        },
    );

    Ok(())
}

/// SoD gate: mark Submitted proposal approved for award.
#[reducer]
pub fn approve_proposal(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "approve")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    if proposal.status != ProposalStatus::Submitted {
        return Err("Only Submitted proposals can be approved for award".to_string());
    }

    ctx.db.proposal().id().update(Proposal {
        award_approved_at: Some(ctx.timestamp),
        award_approved_by: Some(ctx.sender()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "award_approved": true }).to_string()),
            changed_fields: vec!["award_approved_at".into(), "award_approved_by".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn record_proposal_bid_decision(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: RecordProposalBidDecisionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let decision = BidDecisionKind::from_str(&params.decision)?;
    if params.rationale.trim().is_empty() {
        return Err("Bid decision rationale is required".to_string());
    }

    let row = ctx.db.proposal_bid_decision().insert(ProposalBidDecision {
        id: 0,
        organization_id,
        company_id,
        proposal_id,
        decision: decision.clone(),
        rationale: params.rationale.clone(),
        decided_by: ctx.sender(),
        decided_at: ctx.timestamp,
    });

    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_bid_decision",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({
                    "proposal_id": proposal_id,
                    "decision": decision.as_str(),
                    "rationale": params.rationale,
                })
                .to_string(),
            ),
            changed_fields: vec!["decision".into(), "rationale".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn upsert_proposal_section(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    section_id: u64,
    expected_revision: u32,
    params: UpsertProposalSectionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let section_status = SectionStatus::from_str(&params.status)?;
    let word_count = params.content.split_whitespace().count() as u32;

    if section_id == 0 {
        let row = ctx.db.proposal_section().insert(ProposalSection {
            id: 0,
            organization_id,
            proposal_id,
            title: params.title.clone(),
            content: params.content,
            status: section_status,
            ai_suggestion: params.ai_suggestion,
            sequence: params.sequence,
            word_count,
            revision: 1,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
        touch_proposal(ctx, proposal);
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "proposal_section",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(json!({ "title": params.title, "revision": 1 }).to_string()),
                changed_fields: vec!["title".into(), "content".into()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or_else(|| format!("Section {} not found", section_id))?;
    if section.proposal_id != proposal_id {
        return Err("Section does not belong to this proposal".to_string());
    }
    if section.revision != expected_revision {
        return Err(format!(
            "Section conflict: expected revision {}, found {}",
            expected_revision, section.revision
        ));
    }

    let new_revision = section.revision.saturating_add(1);
    ctx.db.proposal_section().id().update(ProposalSection {
        title: params.title,
        content: params.content,
        status: section_status,
        ai_suggestion: params.ai_suggestion,
        sequence: params.sequence,
        word_count,
        revision: new_revision,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..section
    });
    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_section",
            record_id: section_id,
            action: "UPDATE",
            old_values: Some(json!({ "revision": expected_revision }).to_string()),
            new_values: Some(json!({ "revision": new_revision }).to_string()),
            changed_fields: vec!["title".into(), "content".into(), "revision".into()],
            metadata: None,
        },
    );

    Ok(())
}

/// Explicit conflict resolve — force-write and bump revision (no expected_revision check).
#[reducer]
pub fn resolve_proposal_section_conflict(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    section_id: u64,
    params: UpsertProposalSectionParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or_else(|| format!("Section {} not found", section_id))?;
    if section.proposal_id != proposal_id {
        return Err("Section does not belong to this proposal".to_string());
    }

    let section_status = SectionStatus::from_str(&params.status)?;
    let word_count = params.content.split_whitespace().count() as u32;
    let new_revision = section.revision.saturating_add(1);
    let old_rev = section.revision;

    ctx.db.proposal_section().id().update(ProposalSection {
        title: params.title,
        content: params.content,
        status: section_status,
        ai_suggestion: params.ai_suggestion,
        sequence: params.sequence,
        word_count,
        revision: new_revision,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..section
    });
    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_section",
            record_id: section_id,
            action: "UPDATE",
            old_values: Some(json!({ "revision": old_rev }).to_string()),
            new_values: Some(
                json!({ "revision": new_revision, "conflict_resolve": true }).to_string(),
            ),
            changed_fields: vec!["content".into(), "revision".into()],
            metadata: Some(r#"{"conflict_resolve":true}"#.to_string()),
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_proposal_section(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    section_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or_else(|| format!("Section {} not found", section_id))?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, section.proposal_id)?;
    ctx.db.proposal_section().id().delete(&section_id);
    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_section",
            record_id: section_id,
            action: "DELETE",
            old_values: Some(json!({ "title": section.title }).to_string()),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn save_proposal_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    message: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let snapshot = build_server_snapshot(ctx, &proposal);
    let new_version_count = proposal.version_count + 1;

    ctx.db.proposal_version().insert(ProposalVersion {
        id: 0,
        organization_id,
        proposal_id,
        version_number: new_version_count,
        message,
        sections_json: snapshot,
        author_id: ctx.sender(),
        create_date: ctx.timestamp,
    });

    ctx.db.proposal().id().update(Proposal {
        version_count: new_version_count,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_version",
            record_id: proposal_id,
            action: "CREATE",
            old_values: None,
            new_values: Some(json!({ "version_number": new_version_count }).to_string()),
            changed_fields: vec!["version_count".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn restore_proposal_version(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    version_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let version = ctx
        .db
        .proposal_version()
        .id()
        .find(&version_id)
        .ok_or_else(|| format!("Version {} not found", version_id))?;
    if version.proposal_id != proposal_id {
        return Err("Version does not belong to this proposal".to_string());
    }

    let parsed: serde_json::Value = serde_json::from_str(&version.sections_json)
        .map_err(|e| format!("Invalid version snapshot JSON: {e}"))?;
    let sections = parsed
        .get("sections")
        .and_then(|s| s.as_array())
        .ok_or("Version snapshot missing sections array")?;

    // Delete current sections then recreate from snapshot.
    let existing: Vec<u64> = ctx
        .db
        .proposal_section()
        .proposal_section_by_proposal()
        .filter(&proposal_id)
        .map(|s| s.id)
        .collect();
    for id in existing {
        ctx.db.proposal_section().id().delete(&id);
    }

    for s in sections {
        let title = s
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Section")
            .to_string();
        let content = s
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status =
            SectionStatus::from_str(s.get("status").and_then(|v| v.as_str()).unwrap_or("draft"))
                .unwrap_or(SectionStatus::Draft);
        let sequence = s.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let word_count = content.split_whitespace().count() as u32;
        ctx.db.proposal_section().insert(ProposalSection {
            id: 0,
            organization_id,
            proposal_id,
            title,
            content,
            status,
            ai_suggestion: s
                .get("ai_suggestion")
                .and_then(|v| v.as_str())
                .map(|x| x.to_string()),
            sequence,
            word_count,
            revision: 1,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    }

    // Optionally restore value from snapshot when no line restore (lines kept as-is for MVP).
    if let Some(v) = parsed.get("value").and_then(|v| v.as_f64()) {
        let has_lines = ctx
            .db
            .proposal_line_item()
            .line_item_by_proposal()
            .filter(&proposal_id)
            .next()
            .is_some();
        if !has_lines {
            ctx.db.proposal().id().update(Proposal {
                value: v,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..proposal.clone()
            });
        } else {
            touch_proposal(ctx, proposal.clone());
        }
    } else {
        touch_proposal(ctx, proposal.clone());
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                json!({
                    "restored_version_id": version_id,
                    "version_number": version.version_number,
                })
                .to_string(),
            ),
            changed_fields: vec!["sections".into()],
            metadata: Some(r#"{"action":"RESTORE_VERSION"}"#.to_string()),
        },
    );

    Ok(())
}

#[reducer]
pub fn add_proposal_source_doc(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    name: String,
    content: String,
    doc_type: String,
    word_count: u32,
    document_id: Option<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    ensure_source_doc_size(&content)?;

    let row = ctx.db.proposal_source_doc().insert(ProposalSourceDoc {
        id: 0,
        organization_id,
        proposal_id,
        name,
        content,
        doc_type,
        word_count,
        document_id,
        added_by: ctx.sender(),
        added_at: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_source_doc",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(json!({ "name": row.name }).to_string()),
            changed_fields: vec!["name".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_proposal_source_doc(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    doc_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let doc = ctx
        .db
        .proposal_source_doc()
        .id()
        .find(&doc_id)
        .ok_or_else(|| format!("Source doc {} not found", doc_id))?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, doc.proposal_id)?;
    ctx.db.proposal_source_doc().id().delete(&doc_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_source_doc",
            record_id: doc_id,
            action: "DELETE",
            old_values: Some(json!({ "name": doc.name }).to_string()),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_proposal_source_doc(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    doc_id: u64,
    params: UpdateProposalSourceDocParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let doc = ctx
        .db
        .proposal_source_doc()
        .id()
        .find(&doc_id)
        .ok_or_else(|| format!("Source doc {} not found", doc_id))?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, doc.proposal_id)?;

    let name = params.name.unwrap_or_else(|| doc.name.clone());
    let content = params.content.unwrap_or_else(|| doc.content.clone());
    ensure_source_doc_size(&content)?;
    let doc_type = params.doc_type.unwrap_or_else(|| doc.doc_type.clone());
    let word_count = params.word_count.unwrap_or(doc.word_count);
    let document_id = params.document_id.or(doc.document_id);

    let old_values_json = json!({ "name": doc.name, "word_count": doc.word_count }).to_string();
    let new_row = ProposalSourceDoc {
        name,
        content,
        doc_type,
        word_count,
        document_id,
        ..doc
    };
    let new_values_json =
        json!({ "name": new_row.name, "word_count": new_row.word_count }).to_string();
    ctx.db.proposal_source_doc().id().update(new_row);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_source_doc",
            record_id: doc_id,
            action: "UPDATE",
            old_values: Some(old_values_json),
            new_values: Some(new_values_json),
            changed_fields: vec![
                "name".into(),
                "content".into(),
                "doc_type".into(),
                "word_count".into(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn add_proposal_line_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: AddProposalLineItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    // PRO-002: when section_id is provided, validate it exists and belongs to this proposal
    if let Some(sid) = params.section_id {
        let section = ctx
            .db
            .proposal_section()
            .id()
            .find(&sid)
            .ok_or_else(|| format!("Proposal section {} not found", sid))?;
        if section.proposal_id != proposal_id {
            return Err("Section does not belong to this proposal".to_string());
        }
    }

    // PRO-003: validate product_id exists in the org
    let prod = ctx
        .db
        .product()
        .id()
        .find(&params.product_id)
        .ok_or_else(|| format!("Product {} not found", params.product_id))?;
    if prod.organization_id != organization_id {
        return Err("Product does not belong to this organization".to_string());
    }

    let subtotal = line_subtotal(params.quantity, params.price_unit, params.discount);
    let sequence = ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal_id)
        .map(|item| item.sequence)
        .max()
        .unwrap_or(0)
        + 10;

    let row = ctx.db.proposal_line_item().insert(ProposalLineItem {
        id: 0,
        organization_id,
        proposal_id,
        section_id: params.section_id,
        product_id: params.product_id,
        product_name: params.product_name,
        product_variant_id: params.product_variant_id,
        description: params.description,
        quantity: params.quantity,
        price_unit: params.price_unit,
        subtotal,
        discount: params.discount,
        sequence,
        notes: params.notes,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    recompute_proposal_value(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_line_item",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({ "product_id": row.product_id, "subtotal": subtotal }).to_string(),
            ),
            changed_fields: vec!["product_id".into(), "quantity".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn update_proposal_line_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_item_id: u64,
    params: UpdateProposalLineItemParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let item = ctx
        .db
        .proposal_line_item()
        .id()
        .find(&line_item_id)
        .ok_or_else(|| format!("Line item {} not found", line_item_id))?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, item.proposal_id)?;

    let quantity = params.quantity.unwrap_or(item.quantity);
    let price_unit = params.price_unit.unwrap_or(item.price_unit);
    let discount = params.discount.unwrap_or(item.discount);
    let notes = params.notes.or_else(|| item.notes.clone());
    let description = params.description.or_else(|| item.description.clone());
    let subtotal = line_subtotal(quantity, price_unit, discount);

    ctx.db.proposal_line_item().id().update(ProposalLineItem {
        quantity,
        price_unit,
        subtotal,
        discount,
        notes,
        description,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..item
    });

    recompute_proposal_value(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_line_item",
            record_id: line_item_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "subtotal": subtotal }).to_string()),
            changed_fields: vec!["quantity".into(), "price_unit".into(), "discount".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn delete_proposal_line_item(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    line_item_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let item = ctx
        .db
        .proposal_line_item()
        .id()
        .find(&line_item_id)
        .ok_or_else(|| format!("Line item {} not found", line_item_id))?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, item.proposal_id)?;
    ctx.db.proposal_line_item().id().delete(&line_item_id);
    recompute_proposal_value(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_line_item",
            record_id: line_item_id,
            action: "DELETE",
            old_values: Some(json!({ "product_id": item.product_id }).to_string()),
            new_values: None,
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn reorder_proposal_line_items(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    ordered_ids: Vec<u64>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    for (index, item_id) in ordered_ids.iter().enumerate() {
        if let Some(item) = ctx.db.proposal_line_item().id().find(item_id) {
            if item.proposal_id == proposal_id {
                ctx.db.proposal_line_item().id().update(ProposalLineItem {
                    sequence: (index as u32 + 1) * 10,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..item
                });
            }
        }
    }

    Ok(())
}

#[reducer]
pub fn update_proposal_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    section_id: Option<u64>,
    user_name: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "read")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    let existing = ctx
        .db
        .proposal_presence()
        .presence_by_user()
        .filter(&ctx.sender())
        .find(|p| p.proposal_id == proposal_id);

    if let Some(row) = existing {
        ctx.db.proposal_presence().id().update(ProposalPresence {
            section_id,
            user_name,
            last_seen: ctx.timestamp,
            ..row
        });
    } else {
        ctx.db.proposal_presence().insert(ProposalPresence {
            id: 0,
            organization_id,
            proposal_id,
            section_id,
            user_id: ctx.sender(),
            user_name,
            cursor_position: None,
            last_seen: ctx.timestamp,
        });
    }

    Ok(())
}

#[reducer]
pub fn clear_proposal_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "read")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    let ids: Vec<u64> = ctx
        .db
        .proposal_presence()
        .presence_by_user()
        .filter(&ctx.sender())
        .filter(|p| p.proposal_id == proposal_id)
        .map(|p| p.id)
        .collect();

    for id in ids {
        ctx.db.proposal_presence().id().delete(&id);
    }

    Ok(())
}

/// Remove stale presence rows older than `max_age_micros` (caller/worker driven).
#[reducer]
pub fn cleanup_stale_proposal_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    max_age_micros: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let now = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;
    let cutoff = now.saturating_sub(max_age_micros);

    let stale: Vec<u64> = ctx
        .db
        .proposal_presence()
        .iter()
        .filter(|p| p.organization_id == organization_id)
        .filter(|p| {
            let seen = p
                .last_seen
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_micros() as u64;
            seen < cutoff
        })
        .map(|p| p.id)
        .collect();

    for id in stale {
        ctx.db.proposal_presence().id().delete(&id);
    }

    Ok(())
}

#[reducer]
pub fn add_proposal_comment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    section_id: u64,
    content: String,
    parent_id: Option<u64>,
    author_name: String,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    if content.trim().is_empty() {
        return Err("Comment content cannot be empty".to_string());
    }
    // PRO-001: validate section_id exists and belongs to this proposal
    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or_else(|| format!("Proposal section {} not found", section_id))?;
    if section.proposal_id != proposal_id {
        return Err("Section does not belong to this proposal".to_string());
    }
    // PRO-004: validate parent comment exists and belongs to this proposal
    if let Some(pid) = parent_id {
        let parent = ctx
            .db
            .proposal_comment()
            .id()
            .find(&pid)
            .ok_or_else(|| format!("Parent comment {} not found", pid))?;
        if parent.proposal_id != proposal_id {
            return Err("Parent comment does not belong to this proposal".to_string());
        }
    }

    let row = ctx.db.proposal_comment().insert(ProposalComment {
        id: 0,
        organization_id,
        proposal_id,
        section_id,
        author_id: ctx.sender(),
        author_name,
        content,
        parent_id,
        is_resolved: false,
        resolved_by: None,
        create_date: ctx.timestamp,
        write_date: ctx.timestamp,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_comment",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(json!({ "section_id": section_id }).to_string()),
            changed_fields: vec!["content".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn resolve_proposal_comment(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    comment_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let comment = ctx
        .db
        .proposal_comment()
        .id()
        .find(&comment_id)
        .ok_or_else(|| format!("Comment {} not found", comment_id))?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, comment.proposal_id)?;

    ctx.db.proposal_comment().id().update(ProposalComment {
        is_resolved: true,
        resolved_by: Some(ctx.sender()),
        write_date: ctx.timestamp,
        ..comment
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_comment",
            record_id: comment_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "is_resolved": true }).to_string()),
            changed_fields: vec!["is_resolved".into()],
            metadata: None,
        },
    );

    Ok(())
}

#[reducer]
pub fn convert_proposal_to_sale_order(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: ConvertProposalToSaleOrderParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    if proposal.status != ProposalStatus::Awarded {
        return Err("Only Awarded proposals can convert to a sale order".to_string());
    }
    if proposal.sale_order_id.is_some() {
        return Err("Proposal already converted to a sale order".to_string());
    }

    let partner_id = proposal
        .partner_id
        .ok_or("Proposal has no partner_id — set a CRM partner before converting")?;

    if let Some(partner) = ctx.db.contact().id().find(&partner_id) {
        if !partner.is_customer {
            ctx.db.contact().id().update(Contact {
                is_customer: true,
                ..partner
            });
        }
    }

    let lines: Vec<_> = ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal_id)
        .collect();
    if lines.is_empty() {
        return Err("Proposal has no line items to convert".to_string());
    }

    let order_lines: Vec<CreateSaleOrderLineParams> = {
        let mut out = Vec::with_capacity(lines.len());
        for l in &lines {
            let Some(product) = ctx.db.product().id().find(&l.product_id) else {
                return Err(format!("Proposal line product {} not found", l.product_id));
            };
            if product.organization_id != organization_id {
                return Err(format!(
                    "Proposal line product {} does not belong to this organization",
                    l.product_id
                ));
            }
            let uom_id = product.uom_id;
            if uom_id == 0 {
                return Err(format!("Proposal line product {} has no UoM", l.product_id));
            }
            out.push(CreateSaleOrderLineParams {
                product_id: l.product_id,
                quantity: l.quantity,
                uom_id,
                price_unit: Some(l.price_unit),
                discount: l.discount,
                tax_ids: vec![],
                name: Some(l.product_name.clone()),
                sequence: l.sequence,
                is_downpayment: false,
                display_type: None,
                product_variant_id: l.product_variant_id,
                packaging_id: None,
                route_id: None,
                analytic_tag_ids: vec![],
                customer_lead: None,
                metadata: None,
            });
        }
        out
    };

    let so_params = CreateSaleOrderParams {
        company_id: Some(company_id),
        partner_id,
        partner_invoice_id: partner_id,
        partner_shipping_id: partner_id,
        pricelist_id: params.pricelist_id,
        currency_id: proposal.currency_id,
        warehouse_id: params.warehouse_id,
        order_lines,
        origin: Some(format!("PROPOSAL/{}", proposal_id)),
        client_order_ref: None,
        payment_term_id: None,
        fiscal_position_id: None,
        team_id: None,
        opportunity_id: None,
        proposal_id: Some(proposal_id),
        note: proposal.description.clone(),
        terms_and_conditions: None,
        validity_days: None,
        shipping_policy: None,
        picking_policy: None,
        campaign_id: None,
        medium_id: None,
        source_id: None,
        commitment_date: None,
        expected_date: proposal.deadline,
        incoterm_id: None,
        incoterm: None,
        incoterm_location: None,
        carrier_id: None,
        customer_lead: None,
        analytic_account_id: None,
        user_id: Some(proposal.owner_id),
        is_printed: None,
        is_locked: None,
        is_dropship: None,
        invoice_policy: None,
        message_follower_ids: None,
        message_partner_ids: None,
        message_channel_ids: None,
        activity_ids: None,
        metadata: None,
    };

    create_sale_order(ctx, organization_id, so_params)?;

    let so_id = ctx
        .db
        .sale_order()
        .iter()
        .filter(|o| o.organization_id == organization_id && o.proposal_id == Some(proposal_id))
        .map(|o| o.id)
        .max()
        .ok_or("Sale order created but not found for proposal")?;

    ctx.db.proposal().id().update(Proposal {
        sale_order_id: Some(so_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "sale_order_id": so_id }).to_string()),
            changed_fields: vec!["sale_order_id".into()],
            metadata: Some(r#"{"action":"CONVERT_TO_SALE_ORDER"}"#.to_string()),
        },
    );

    Ok(())
}

#[reducer]
pub fn convert_proposal_to_project(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: ConvertProposalToProjectParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    if proposal.status != ProposalStatus::Awarded {
        return Err("Only Awarded proposals can convert to a project".to_string());
    }
    if proposal.project_id.is_some() {
        return Err("Proposal already converted to a project".to_string());
    }

    let project_params = CreateProjectParams {
        company_id: Some(company_id),
        name: proposal.title.clone(),
        description: proposal.description.clone(),
        active: true,
        sequence: 10,
        currency_id: proposal.currency_id,
        partner_id: proposal.partner_id,
        partner_email: None,
        partner_phone: None,
        partner_company_id: None,
        date_start: Some(ctx.timestamp),
        date: Some(ctx.timestamp),
        date_end: proposal.deadline,
        allow_subtasks: true,
        allow_recurring_tasks: false,
        allow_task_dependencies: true,
        allow_timesheets: true,
        allow_timesheet_timer: true,
        allow_material: true,
        allow_worksheets: false,
        allow_forecast: true,
        allow_wip_je: false,
        bill_type: params.bill_type,
        pricing_type: params.pricing_type,
        rating_status: "undefined".to_string(),
        rating_status_period: "month".to_string(),
        privacy_visibility: "employees".to_string(),
        access_instruction_message: None,
        task_count: 0,
        task_count_open: 0,
        task_count_closed: 0,
        task_count_in_progress: 0,
        task_count_blocked: 0,
        sale_order_id: proposal.sale_order_id,
        sale_line_id: None,
        last_update_status: "on_track".to_string(),
        last_update_color: None,
        is_favorite: false,
        color: None,
        stage_id: None,
        analytic_account_id: None,
        activity_ids: vec![],
        activity_state: None,
        activity_date_deadline: None,
        activity_type_id: None,
        activity_user_id: None,
        activity_summary: None,
        message_follower_ids: vec![],
        message_ids: vec![],
        metadata: Some(format!(r#"{{"proposal_id":{}}}"#, proposal_id)),
    };

    create_project(ctx, organization_id, project_params)?;

    let project_id = ctx
        .db
        .project_project()
        .iter()
        .filter(|p| {
            p.organization_id == organization_id
                && p.company_id == company_id
                && p.name == proposal.title
                && p.metadata
                    .as_ref()
                    .is_some_and(|m| m.contains(&format!("\"proposal_id\":{proposal_id}")))
        })
        .map(|p| p.id)
        .max()
        .ok_or("Project created but not found for proposal")?;

    ctx.db.proposal().id().update(Proposal {
        project_id: Some(project_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "project_id": project_id }).to_string()),
            changed_fields: vec!["project_id".into()],
            metadata: Some(r#"{"action":"CONVERT_TO_PROJECT"}"#.to_string()),
        },
    );

    Ok(())
}

// ============================================================================
// WAVE D/E — Templates, compliance, clauses, analyze, esign link, intents, portal
// ============================================================================

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub enum ProposalIntentType {
    PdfRender,
    DocxRender,
    PortalSubmit,
    PortalClarification,
    EsignRequest,
}

impl ProposalIntentType {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "pdf_render" => Ok(Self::PdfRender),
            "docx_render" => Ok(Self::DocxRender),
            "portal_submit" => Ok(Self::PortalSubmit),
            "portal_clarification" => Ok(Self::PortalClarification),
            "esign_request" => Ok(Self::EsignRequest),
            other => Err(format!(
                "Invalid intent_type '{}'. Valid: pdf_render, docx_render, portal_submit, portal_clarification, esign_request",
                other
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PdfRender => "pdf_render",
            Self::DocxRender => "docx_render",
            Self::PortalSubmit => "portal_submit",
            Self::PortalClarification => "portal_clarification",
            Self::EsignRequest => "esign_request",
        }
    }
}

/// Org/company library of multilingual proposal section skeletons.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_template,
    public,
    index(accessor = proposal_template_by_org, btree(columns = [organization_id])),
    index(accessor = proposal_template_by_company, btree(columns = [company_id])),
    index(accessor = proposal_template_by_locale, btree(columns = [locale]))
)]
pub struct ProposalTemplate {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub name: String,
    pub category: String,
    pub locale: String,
    pub country_pack_key: Option<String>,
    /// JSON array: [{ "title", "sequence", "content" }]
    pub sections_json: String,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Reusable commercial / legal clause snippets (pack-aware).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_clause,
    public,
    index(accessor = proposal_clause_by_org, btree(columns = [organization_id])),
    index(accessor = proposal_clause_by_company, btree(columns = [company_id])),
    index(accessor = proposal_clause_by_key, btree(columns = [clause_key]))
)]
pub struct ProposalClause {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub clause_key: String,
    pub title: String,
    pub body: String,
    pub locale: String,
    pub country_pack_key: Option<String>,
    pub is_active: bool,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Tender compliance / document-requirement matrix rows.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_compliance_requirement,
    public,
    index(accessor = compliance_by_proposal, btree(columns = [proposal_id])),
    index(accessor = compliance_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalComplianceRequirement {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub requirement_key: String,
    pub title: String,
    pub description: Option<String>,
    pub is_required: bool,
    pub is_complete: bool,
    pub is_waived: bool,
    pub waiver_rationale: Option<String>,
    pub evidence_document_id: Option<u64>,
    pub sequence: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Persisted AI / RFP analysis output (not client-only JSON).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_analysis,
    public,
    index(accessor = analysis_by_proposal, btree(columns = [proposal_id])),
    index(accessor = analysis_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalAnalysis {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub source: String,
    pub is_mock: bool,
    pub findings_json: String,
    pub requirements_json: String,
    pub evaluation_criteria_json: String,
    pub suggested_sections_json: String,
    pub score_json: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

/// Preferential / local-content procurement scoring (ZA B-BBEE, SEA local content, …).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_procurement_score,
    public,
    index(accessor = procurement_score_by_proposal, btree(columns = [proposal_id])),
    index(accessor = procurement_score_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalProcurementScore {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub country_pack_key: String,
    pub score_kind: String,
    pub score_value: f64,
    pub max_value: f64,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// Worker intents: PDF/DOCX render, portal submit, e-sign (no HTTP in reducers).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_integration_intent,
    public,
    index(accessor = proposal_intent_by_org, btree(columns = [organization_id])),
    index(accessor = proposal_intent_by_company, btree(columns = [company_id])),
    index(accessor = proposal_intent_by_proposal, btree(columns = [proposal_id])),
    index(accessor = proposal_intent_by_status, btree(columns = [status])),
    index(accessor = proposal_intent_by_key, btree(columns = [idempotency_key]))
)]
pub struct ProposalIntegrationIntent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub proposal_version_id: Option<u64>,
    pub intent_type: String,
    pub status: String,
    pub idempotency_key: String,
    pub payload: String,
    pub result_document_id: Option<u64>,
    pub last_error: Option<String>,
    pub attempt_count: u32,
    pub applied_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Bidder/customer portal clarifications (external principal flagged).
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal_clarification,
    public,
    index(accessor = clarification_by_proposal, btree(columns = [proposal_id])),
    index(accessor = clarification_by_org, btree(columns = [organization_id]))
)]
pub struct ProposalClarification {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub proposal_id: u64,
    pub author_name: String,
    pub author_email: Option<String>,
    pub is_portal_principal: bool,
    pub question: String,
    pub answer: Option<String>,
    pub answered_by: Option<Identity>,
    pub answered_at: Option<Timestamp>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

// ── Wave D/E params ──────────────────────────────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProposalTemplateParams {
    pub name: String,
    pub category: String,
    pub locale: String,
    pub country_pack_key: Option<String>,
    pub sections_json: String,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProposalClauseParams {
    pub clause_key: String,
    pub title: String,
    pub body: String,
    pub locale: String,
    pub country_pack_key: Option<String>,
    pub is_active: bool,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertProposalComplianceRequirementParams {
    pub requirement_key: String,
    pub title: String,
    pub description: Option<String>,
    pub is_required: bool,
    pub is_complete: bool,
    pub is_waived: bool,
    pub waiver_rationale: Option<String>,
    pub evidence_document_id: Option<u64>,
    pub sequence: u32,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct ApplyProposalAnalysisParams {
    pub source: String,
    pub is_mock: bool,
    pub findings_json: String,
    pub requirements_json: String,
    pub evaluation_criteria_json: String,
    pub suggested_sections_json: String,
    pub score_json: Option<String>,
    pub materialize_compliance: bool,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpsertProposalProcurementScoreParams {
    pub country_pack_key: String,
    pub score_kind: String,
    pub score_value: f64,
    pub max_value: f64,
    pub notes: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProposalIntegrationIntentParams {
    pub proposal_version_id: Option<u64>,
    pub intent_type: String,
    pub idempotency_key: String,
    pub payload: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CompleteProposalIntegrationIntentParams {
    pub result_document_id: Option<u64>,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct FailProposalIntegrationIntentParams {
    pub last_error: String,
    pub metadata: Option<String>,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateProposalClarificationParams {
    pub author_name: String,
    pub author_email: Option<String>,
    pub is_portal_principal: bool,
    pub question: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct AnswerProposalClarificationParams {
    pub answer: String,
}

#[derive(SpacetimeType, Clone, Debug)]
pub struct LinkProposalVersionEsignParams {
    pub document_id: u64,
    pub proposal_version_id: u64,
    pub provider: String,
    pub external_envelope_id: String,
    pub signers_json: Option<String>,
    pub metadata: Option<String>,
}

// ── Wave D/E helpers ─────────────────────────────────────────────────────────

fn json_str_field(value: &serde_json::Value, keys: &[&str], default: &str) -> String {
    keys.iter()
        .find_map(|k| value.get(*k).and_then(|v| v.as_str()))
        .unwrap_or(default)
        .to_string()
}

fn load_integration_intent_scoped(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
) -> Result<ProposalIntegrationIntent, String> {
    require_company_in_organization(ctx, organization_id, company_id)?;
    let intent = ctx
        .db
        .proposal_integration_intent()
        .id()
        .find(&intent_id)
        .ok_or("Integration intent not found")?;
    if intent.organization_id != organization_id || intent.company_id != company_id {
        return Err("Intent does not belong to this company".to_string());
    }
    Ok(intent)
}

fn ensure_version_belongs_to_proposal(
    ctx: &ReducerContext,
    proposal_id: u64,
    version_id: u64,
) -> Result<(), String> {
    let version = ctx
        .db
        .proposal_version()
        .id()
        .find(&version_id)
        .ok_or("Proposal version not found")?;
    if version.proposal_id != proposal_id {
        return Err("Version does not belong to this proposal".to_string());
    }
    Ok(())
}

fn merge_json_object_metadata(mut base: serde_json::Value, extra: Option<&str>) -> String {
    if let Some(raw) = extra {
        if let Ok(extra_val) = serde_json::from_str::<serde_json::Value>(raw) {
            if let (Some(base_obj), Some(extra_obj)) = (base.as_object_mut(), extra_val.as_object())
            {
                for (k, v) in extra_obj {
                    base_obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    base.to_string()
}

// ── Wave D/E reducers ────────────────────────────────────────────────────────

#[reducer]
pub fn create_proposal_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProposalTemplateParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    if params.name.trim().is_empty() {
        return Err("Template name cannot be empty".to_string());
    }
    let _parsed: serde_json::Value = serde_json::from_str(&params.sections_json)
        .map_err(|e| format!("sections_json must be valid JSON: {e}"))?;

    let row = ctx.db.proposal_template().insert(ProposalTemplate {
        id: 0,
        organization_id,
        company_id,
        name: params.name.clone(),
        category: params.category,
        locale: params.locale,
        country_pack_key: params.country_pack_key,
        sections_json: params.sections_json,
        is_active: params.is_active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_template",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(json!({ "name": row.name, "locale": row.locale }).to_string()),
            changed_fields: vec!["name".into(), "sections_json".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_proposal_template(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    template_id: u64,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let template = ctx
        .db
        .proposal_template()
        .id()
        .find(&template_id)
        .ok_or("Proposal template not found")?;
    if template.organization_id != organization_id || template.company_id != company_id {
        return Err("Template does not belong to this company".to_string());
    }
    if !template.is_active {
        return Err("Template is inactive".to_string());
    }

    let parsed: serde_json::Value = serde_json::from_str(&template.sections_json)
        .map_err(|e| format!("Invalid template sections_json: {e}"))?;
    let sections = parsed
        .as_array()
        .ok_or("Template sections_json must be a JSON array")?;

    for (i, s) in sections.iter().enumerate() {
        let title = json_str_field(s, &["title"], "Section");
        let content = json_str_field(s, &["content"], "");
        let sequence = s
            .get("sequence")
            .and_then(|v| v.as_u64())
            .unwrap_or((i as u64 + 1) * 10) as u32;
        upsert_proposal_section(
            ctx,
            organization_id,
            company_id,
            proposal_id,
            0,
            0,
            UpsertProposalSectionParams {
                title,
                content,
                status: "draft".to_string(),
                sequence,
                ai_suggestion: None,
            },
        )?;
    }

    ctx.db.proposal().id().update(Proposal {
        template_id: Some(template_id),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "template_id": template_id }).to_string()),
            changed_fields: vec!["template_id".into()],
            metadata: Some(r#"{"action":"APPLY_TEMPLATE"}"#.to_string()),
        },
    );
    Ok(())
}

#[reducer]
pub fn create_proposal_clause(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateProposalClauseParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    require_company_in_organization(ctx, organization_id, company_id)?;
    if params.clause_key.trim().is_empty() || params.body.trim().is_empty() {
        return Err("clause_key and body are required".to_string());
    }

    let row = ctx.db.proposal_clause().insert(ProposalClause {
        id: 0,
        organization_id,
        company_id,
        clause_key: params.clause_key.clone(),
        title: params.title,
        body: params.body,
        locale: params.locale,
        country_pack_key: params.country_pack_key,
        is_active: params.is_active,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_clause",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(json!({ "clause_key": row.clause_key }).to_string()),
            changed_fields: vec!["clause_key".into(), "body".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn upsert_proposal_compliance_requirement(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    requirement_id: u64,
    params: UpsertProposalComplianceRequirementParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    if params.is_waived
        && params
            .waiver_rationale
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err("waiver_rationale is required when waiving a requirement".to_string());
    }

    if requirement_id == 0 {
        let row = ctx
            .db
            .proposal_compliance_requirement()
            .insert(ProposalComplianceRequirement {
                id: 0,
                organization_id,
                company_id,
                proposal_id,
                requirement_key: params.requirement_key.clone(),
                title: params.title,
                description: params.description,
                is_required: params.is_required,
                is_complete: params.is_complete,
                is_waived: params.is_waived,
                waiver_rationale: params.waiver_rationale,
                evidence_document_id: params.evidence_document_id,
                sequence: params.sequence,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
            });
        touch_proposal(ctx, proposal);
        write_audit_log_v2(
            ctx,
            organization_id,
            AuditLogParams {
                company_id: Some(company_id),
                table_name: "proposal_compliance_requirement",
                record_id: row.id,
                action: "CREATE",
                old_values: None,
                new_values: Some(json!({ "requirement_key": params.requirement_key }).to_string()),
                changed_fields: vec!["requirement_key".into()],
                metadata: None,
            },
        );
        return Ok(());
    }

    let row = ctx
        .db
        .proposal_compliance_requirement()
        .id()
        .find(&requirement_id)
        .ok_or("Compliance requirement not found")?;
    if row.proposal_id != proposal_id {
        return Err("Compliance requirement does not belong to this proposal".to_string());
    }

    ctx.db
        .proposal_compliance_requirement()
        .id()
        .update(ProposalComplianceRequirement {
            requirement_key: params.requirement_key,
            title: params.title,
            description: params.description,
            is_required: params.is_required,
            is_complete: params.is_complete,
            is_waived: params.is_waived,
            waiver_rationale: params.waiver_rationale,
            evidence_document_id: params.evidence_document_id,
            sequence: params.sequence,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });
    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_compliance_requirement",
            record_id: requirement_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                json!({ "is_complete": params.is_complete, "is_waived": params.is_waived })
                    .to_string(),
            ),
            changed_fields: vec!["is_complete".into(), "is_waived".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn apply_proposal_analysis(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: ApplyProposalAnalysisParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;

    let row = ctx.db.proposal_analysis().insert(ProposalAnalysis {
        id: 0,
        organization_id,
        company_id,
        proposal_id,
        source: params.source.clone(),
        is_mock: params.is_mock,
        findings_json: params.findings_json,
        requirements_json: params.requirements_json.clone(),
        evaluation_criteria_json: params.evaluation_criteria_json,
        suggested_sections_json: params.suggested_sections_json,
        score_json: params.score_json,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
    });

    if params.materialize_compliance {
        if let Ok(reqs) = serde_json::from_str::<Vec<serde_json::Value>>(&params.requirements_json)
        {
            for (i, req) in reqs.iter().enumerate() {
                let key = json_str_field(req, &["id", "key"], &format!("req-{}", i + 1));
                let title = json_str_field(req, &["title", "text"], "Requirement");
                let description = req
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                upsert_proposal_compliance_requirement(
                    ctx,
                    organization_id,
                    company_id,
                    proposal_id,
                    0,
                    UpsertProposalComplianceRequirementParams {
                        requirement_key: key,
                        title,
                        description,
                        is_required: true,
                        is_complete: false,
                        is_waived: false,
                        waiver_rationale: None,
                        evidence_document_id: None,
                        sequence: ((i as u32) + 1) * 10,
                    },
                )?;
            }
        }
    }

    touch_proposal(ctx, proposal);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_analysis",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({ "source": params.source, "is_mock": params.is_mock }).to_string(),
            ),
            changed_fields: vec!["findings_json".into(), "requirements_json".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn upsert_proposal_procurement_score(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: UpsertProposalProcurementScoreParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    if params.country_pack_key.trim().is_empty() || params.score_kind.trim().is_empty() {
        return Err("country_pack_key and score_kind are required".to_string());
    }

    let existing = ctx
        .db
        .proposal_procurement_score()
        .procurement_score_by_proposal()
        .filter(&proposal_id)
        .find(|s| {
            s.score_kind == params.score_kind && s.country_pack_key == params.country_pack_key
        });

    if let Some(row) = existing {
        ctx.db
            .proposal_procurement_score()
            .id()
            .update(ProposalProcurementScore {
                score_value: params.score_value,
                max_value: params.max_value,
                notes: params.notes,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..row
            });
    } else {
        ctx.db
            .proposal_procurement_score()
            .insert(ProposalProcurementScore {
                id: 0,
                organization_id,
                company_id,
                proposal_id,
                country_pack_key: params.country_pack_key.clone(),
                score_kind: params.score_kind.clone(),
                score_value: params.score_value,
                max_value: params.max_value,
                notes: params.notes,
                create_uid: ctx.sender(),
                create_date: ctx.timestamp,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
            });
    }

    touch_proposal(ctx, proposal);
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_procurement_score",
            record_id: proposal_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                json!({
                    "score_kind": params.score_kind,
                    "score_value": params.score_value,
                    "country_pack_key": params.country_pack_key,
                })
                .to_string(),
            ),
            changed_fields: vec!["score_value".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_proposal_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: CreateProposalIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    let intent_type = ProposalIntentType::from_str(&params.intent_type)?;
    if params.idempotency_key.trim().is_empty() {
        return Err("idempotency_key is required".to_string());
    }

    if let Some(existing) = ctx
        .db
        .proposal_integration_intent()
        .proposal_intent_by_key()
        .filter(&params.idempotency_key)
        .find(|i| i.organization_id == organization_id)
    {
        if existing.proposal_id == proposal_id {
            return Ok(());
        }
        return Err("idempotency_key already used for another proposal".to_string());
    }

    if let Some(version_id) = params.proposal_version_id {
        ensure_version_belongs_to_proposal(ctx, proposal_id, version_id)?;
    }

    let row = ctx
        .db
        .proposal_integration_intent()
        .insert(ProposalIntegrationIntent {
            id: 0,
            organization_id,
            company_id,
            proposal_id,
            proposal_version_id: params.proposal_version_id,
            intent_type: intent_type.as_str().to_string(),
            status: "pending".to_string(),
            idempotency_key: params.idempotency_key,
            payload: params.payload,
            result_document_id: None,
            last_error: None,
            attempt_count: 0,
            applied_at: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_integration_intent",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({ "intent_type": intent_type.as_str(), "status": "pending" }).to_string(),
            ),
            changed_fields: vec!["intent_type".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn complete_proposal_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: CompleteProposalIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let intent = load_integration_intent_scoped(ctx, organization_id, company_id, intent_id)?;
    if intent.status == "completed" {
        return Ok(());
    }

    ctx.db
        .proposal_integration_intent()
        .id()
        .update(ProposalIntegrationIntent {
            status: "completed".to_string(),
            result_document_id: params.result_document_id.or(intent.result_document_id),
            applied_at: Some(ctx.timestamp),
            attempt_count: intent.attempt_count.saturating_add(1),
            last_error: None,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(intent.metadata.clone()),
            ..intent
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "status": "completed" }).to_string()),
            changed_fields: vec!["status".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn fail_proposal_integration_intent(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    intent_id: u64,
    params: FailProposalIntegrationIntentParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let intent = load_integration_intent_scoped(ctx, organization_id, company_id, intent_id)?;

    ctx.db
        .proposal_integration_intent()
        .id()
        .update(ProposalIntegrationIntent {
            status: "failed".to_string(),
            last_error: Some(params.last_error.clone()),
            attempt_count: intent.attempt_count.saturating_add(1),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: params.metadata.or(intent.metadata.clone()),
            ..intent
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_integration_intent",
            record_id: intent_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(
                json!({ "status": "failed", "last_error": params.last_error }).to_string(),
            ),
            changed_fields: vec!["status".into(), "last_error".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn create_proposal_clarification(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: CreateProposalClarificationParams,
) -> Result<(), String> {
    // Portal principals use write on submitted proposals only; internal staff use write always.
    check_permission(ctx, organization_id, "proposal", "write")?;
    let proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    if params.is_portal_principal && proposal.status != ProposalStatus::Submitted {
        return Err("Portal clarifications are only allowed on Submitted proposals".to_string());
    }
    if params.question.trim().is_empty() {
        return Err("question is required".to_string());
    }

    let row = ctx
        .db
        .proposal_clarification()
        .insert(ProposalClarification {
            id: 0,
            organization_id,
            company_id,
            proposal_id,
            author_name: params.author_name,
            author_email: params.author_email,
            is_portal_principal: params.is_portal_principal,
            question: params.question,
            answer: None,
            answered_by: None,
            answered_at: None,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_clarification",
            record_id: row.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(
                json!({ "is_portal_principal": params.is_portal_principal }).to_string(),
            ),
            changed_fields: vec!["question".into()],
            metadata: None,
        },
    );
    Ok(())
}

#[reducer]
pub fn answer_proposal_clarification(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    clarification_id: u64,
    params: AnswerProposalClarificationParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let row = ctx
        .db
        .proposal_clarification()
        .id()
        .find(&clarification_id)
        .ok_or("Clarification not found")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, row.proposal_id)?;
    if params.answer.trim().is_empty() {
        return Err("answer is required".to_string());
    }

    ctx.db
        .proposal_clarification()
        .id()
        .update(ProposalClarification {
            answer: Some(params.answer),
            answered_by: Some(ctx.sender()),
            answered_at: Some(ctx.timestamp),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..row
        });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "proposal_clarification",
            record_id: clarification_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(json!({ "answered": true }).to_string()),
            changed_fields: vec!["answer".into()],
            metadata: None,
        },
    );
    Ok(())
}

/// Link a document e-sign request to a proposal version (stores ids in signature metadata + intent).
#[reducer]
pub fn link_proposal_version_esign(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    proposal_id: u64,
    params: LinkProposalVersionEsignParams,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "write")?;
    let _proposal = load_proposal_scoped(ctx, organization_id, company_id, proposal_id)?;
    ensure_version_belongs_to_proposal(ctx, proposal_id, params.proposal_version_id)?;

    let merged_meta = merge_json_object_metadata(
        json!({
            "proposal_id": proposal_id,
            "proposal_version_id": params.proposal_version_id,
            "linked_by": "link_proposal_version_esign",
        }),
        params.metadata.as_deref(),
    );

    crate::documents::esign::create_document_signature_request(
        ctx,
        organization_id,
        params.document_id,
        crate::documents::esign::CreateDocumentSignatureRequestParams {
            provider: params.provider,
            external_envelope_id: params.external_envelope_id,
            signers_json: params.signers_json,
            metadata: Some(merged_meta.clone()),
        },
    )?;

    // Also record an esign intent for worker observability.
    let key = format!(
        "esign-{}-{}-{}",
        proposal_id,
        params.proposal_version_id,
        ctx.timestamp
            .to_duration_since_unix_epoch()
            .unwrap_or_default()
            .as_micros()
    );
    create_proposal_integration_intent(
        ctx,
        organization_id,
        company_id,
        proposal_id,
        CreateProposalIntegrationIntentParams {
            proposal_version_id: Some(params.proposal_version_id),
            intent_type: "esign_request".to_string(),
            idempotency_key: key,
            payload: merged_meta,
            metadata: Some(json!({ "document_id": params.document_id }).to_string()),
        },
    )?;

    Ok(())
}
