/// Proposals & Tenders Module — proposal lifecycle + AI-assisted drafting
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Proposal** | Core proposal (status, value, deadlines) |
/// | **ProposalSection** | Current draft sections |
/// | **ProposalVersion** | Saved version snapshots |
/// | **ProposalSourceDoc** | Source documents for AI analysis |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

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
}

// ============================================================================
// TABLES
// ============================================================================

/// Proposal — core record for a sales proposal / tender response
#[derive(Clone)]
#[spacetimedb::table(
    accessor = proposal,
    public,
    index(accessor = proposal_by_org, btree(columns = [organization_id])),
    index(accessor = proposal_by_status, btree(columns = [status]))
)]
pub struct Proposal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub organization_id: u64,   // Tenant isolation
    pub title: String,
    pub client_name: String,
    pub status: ProposalStatus,
    pub value: f64,             // Estimated monetary value
    pub deadline: Option<Timestamp>,
    pub description: Option<String>,
    pub owner_id: Identity,     // User responsible
    pub version_count: u32,     // Cached version counter
    pub template_id: Option<u64>,
    pub partner_id: Option<u64>,    // linked CRM partner
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// ProposalSection — a single section in the proposal draft
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
    pub sequence: u32,          // Display order
    pub word_count: u32,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// ProposalVersion — immutable snapshot of a proposal at a point in time
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
    pub message: String,        // Commit message
    pub sections_json: String,  // JSON-serialised Vec<ProposalSection> snapshot
    pub author_id: Identity,
    pub create_date: Timestamp,
}

/// ProposalSourceDoc — uploaded or pasted source document for AI analysis
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
    pub doc_type: String,       // "pasted" | "uploaded"
    pub word_count: u32,
    pub added_by: Identity,
    pub added_at: Timestamp,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create a new proposal
#[reducer]
pub fn create_proposal(
    ctx: &ReducerContext,
    organization_id: u64,
    title: String,
    client_name: String,
    value: f64,
    deadline: Option<Timestamp>,
    description: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, organization_id, "proposal", "create")?;

    let row = ctx.db.proposal().insert(Proposal {
        id: 0,
        organization_id,
        title: title.clone(),
        client_name,
        status: ProposalStatus::Draft,
        value,
        deadline,
        description,
        owner_id: ctx.sender(),
        version_count: 0,
        template_id: None,
        partner_id: None,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log_v2(ctx, organization_id, AuditLogParams {
        company_id: None,
        table_name: "proposal",
        record_id: row.id,
        action: "create",
        old_values: None,
        new_values: Some(format!("{{\"title\": \"{}\"}}", title)),
        changed_fields: vec![],
        metadata: None,
    });

    Ok(())
}

/// Update a proposal's status
#[reducer]
pub fn update_proposal_status(
    ctx: &ReducerContext,
    proposal_id: u64,
    status: String,
) -> Result<(), String> {
    let proposal = ctx.db.proposal().id().find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let new_status = ProposalStatus::from_str(&status)?;

    ctx.db.proposal().id().update(Proposal {
        status: new_status,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    Ok(())
}

/// Update proposal core fields (title, client, value, deadline)
#[reducer]
pub fn update_proposal(
    ctx: &ReducerContext,
    proposal_id: u64,
    title: String,
    client_name: String,
    value: f64,
    deadline: Option<Timestamp>,
    description: Option<String>,
) -> Result<(), String> {
    let proposal = ctx.db.proposal().id().find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal().id().update(Proposal {
        title,
        client_name,
        value,
        deadline,
        description,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    Ok(())
}

/// Upsert a proposal section (create if section_id == 0, update otherwise)
#[reducer]
pub fn upsert_proposal_section(
    ctx: &ReducerContext,
    proposal_id: u64,
    section_id: u64,
    title: String,
    content: String,
    status: String,
    sequence: u32,
    ai_suggestion: Option<String>,
) -> Result<(), String> {
    let proposal = ctx.db.proposal().id().find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let section_status = SectionStatus::from_str(&status)?;
    let word_count = content.split_whitespace().count() as u32;

    if section_id == 0 {
        ctx.db.proposal_section().insert(ProposalSection {
            id: 0,
            organization_id: proposal.organization_id,
            proposal_id,
            title,
            content,
            status: section_status,
            ai_suggestion,
            sequence,
            word_count,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
        });
    } else {
        let section = ctx.db.proposal_section().id().find(&section_id)
            .ok_or_else(|| format!("Section {} not found", section_id))?;

        ctx.db.proposal_section().id().update(ProposalSection {
            title,
            content,
            status: section_status,
            ai_suggestion,
            sequence,
            word_count,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..section
        });
    }

    // Mark proposal as dirty
    ctx.db.proposal().id().update(Proposal {
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    Ok(())
}

/// Delete a proposal section
#[reducer]
pub fn delete_proposal_section(
    ctx: &ReducerContext,
    section_id: u64,
) -> Result<(), String> {
    let section = ctx.db.proposal_section().id().find(&section_id)
        .ok_or_else(|| format!("Section {} not found", section_id))?;

    let proposal = ctx.db.proposal().id().find(&section.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", section.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_section().id().delete(&section_id);

    Ok(())
}

/// Save a version snapshot of the proposal
#[reducer]
pub fn save_proposal_version(
    ctx: &ReducerContext,
    proposal_id: u64,
    message: String,
    sections_json: String,
) -> Result<(), String> {
    let proposal = ctx.db.proposal().id().find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let new_version_count = proposal.version_count + 1;

    ctx.db.proposal_version().insert(ProposalVersion {
        id: 0,
        organization_id: proposal.organization_id,
        proposal_id,
        version_number: new_version_count,
        message,
        sections_json,
        author_id: ctx.sender(),
        create_date: ctx.timestamp,
    });

    ctx.db.proposal().id().update(Proposal {
        version_count: new_version_count,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..proposal
    });

    Ok(())
}

/// Add a source document to a proposal
#[reducer]
pub fn add_proposal_source_doc(
    ctx: &ReducerContext,
    proposal_id: u64,
    name: String,
    content: String,
    doc_type: String,
    word_count: u32,
) -> Result<(), String> {
    let proposal = ctx.db.proposal().id().find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_source_doc().insert(ProposalSourceDoc {
        id: 0,
        organization_id: proposal.organization_id,
        proposal_id,
        name,
        content,
        doc_type,
        word_count,
        added_by: ctx.sender(),
        added_at: ctx.timestamp,
    });

    Ok(())
}

/// Delete a source document from a proposal
#[reducer]
pub fn delete_proposal_source_doc(
    ctx: &ReducerContext,
    doc_id: u64,
) -> Result<(), String> {
    let doc = ctx.db.proposal_source_doc().id().find(&doc_id)
        .ok_or_else(|| format!("Source doc {} not found", doc_id))?;

    let proposal = ctx.db.proposal().id().find(&doc.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", doc.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_source_doc().id().delete(&doc_id);

    Ok(())
}
