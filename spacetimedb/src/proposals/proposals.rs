use serde_json::json;
/// Proposals & Tenders Module — proposal lifecycle + AI-assisted drafting
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **Proposal** | Core proposal (status, value, deadlines) |
/// | **ProposalSection** | Current draft sections |
/// | **ProposalVersion** | Saved version snapshots |
/// | **ProposalSourceDoc** | Source documents for AI analysis |
/// | **ProposalLineItem** | ERP products/services linked to sections |
/// | **ProposalPresence** | Real-time collaborative presence |
/// | **ProposalComment** | Threaded comments per section |
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

    pub organization_id: u64, // Tenant isolation
    pub title: String,
    pub client_name: String,
    pub status: ProposalStatus,
    pub value: f64, // Estimated monetary value
    pub deadline: Option<Timestamp>,
    pub description: Option<String>,
    pub owner_id: Identity, // User responsible
    pub version_count: u32, // Cached version counter
    pub template_id: Option<u64>,
    pub partner_id: Option<u64>,         // linked CRM partner
    pub document_folder_id: Option<u64>, // optional link into DocumentFolder
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
    pub sequence: u32, // Display order
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
    pub message: String,       // Commit message
    pub sections_json: String, // JSON-serialised Vec<ProposalSection> snapshot
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
    pub doc_type: String, // "pasted" | "uploaded"
    pub word_count: u32,
    pub added_by: Identity,
    pub added_at: Timestamp,
}

// ── Input params (proposal source documents) ─────────────────────────────────

#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateProposalSourceDocParams {
    pub name: Option<String>,
    pub content: Option<String>,
    pub doc_type: Option<String>,
    pub word_count: Option<u32>,
}

/// ProposalLineItem — ERP product/service linked to a proposal (optionally to a section)
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
    pub section_id: Option<u64>, // None = proposal-level line item
    pub product_id: u64,
    pub product_name: String, // Snapshot at time of linking
    pub product_variant_id: Option<u64>,
    pub description: Option<String>,
    pub quantity: f64,
    pub price_unit: f64,
    pub subtotal: f64, // computed: quantity * price_unit * (1 - discount/100)
    pub discount: f64, // percentage, 0.0 = no discount
    pub sequence: u32,
    pub notes: Option<String>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
}

/// ProposalPresence — real-time collaborative presence (who is editing which section)
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
    pub section_id: Option<u64>, // None = viewing top level
    pub user_id: Identity,
    pub user_name: String,
    pub cursor_position: Option<u32>,
    pub last_seen: Timestamp,
}

/// ProposalComment — threaded inline comment on a proposal section
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
    pub parent_id: Option<u64>, // None = root comment, Some = reply
    pub is_resolved: bool,
    pub resolved_by: Option<Identity>,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
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
    document_folder_id: Option<u64>,
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
        document_folder_id,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "proposal",
            record_id: row.id,
            action: "create",
            old_values: None,
            new_values: Some(format!("{{\"title\": \"{}\"}}", title)),
            changed_fields: vec![],
            metadata: None,
        },
    );

    Ok(())
}

/// Update a proposal's status
#[reducer]
pub fn update_proposal_status(
    ctx: &ReducerContext,
    proposal_id: u64,
    status: String,
) -> Result<(), String> {
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
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
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
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
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
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
        let section = ctx
            .db
            .proposal_section()
            .id()
            .find(&section_id)
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
pub fn delete_proposal_section(ctx: &ReducerContext, section_id: u64) -> Result<(), String> {
    let section = ctx
        .db
        .proposal_section()
        .id()
        .find(&section_id)
        .ok_or_else(|| format!("Section {} not found", section_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&section.proposal_id)
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
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
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
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
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
pub fn delete_proposal_source_doc(ctx: &ReducerContext, doc_id: u64) -> Result<(), String> {
    let doc = ctx
        .db
        .proposal_source_doc()
        .id()
        .find(&doc_id)
        .ok_or_else(|| format!("Source doc {} not found", doc_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&doc.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", doc.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_source_doc().id().delete(&doc_id);

    Ok(())
}

/// Update an existing source document (partial update via optional fields)
#[reducer]
pub fn update_proposal_source_doc(
    ctx: &ReducerContext,
    doc_id: u64,
    params: UpdateProposalSourceDocParams,
) -> Result<(), String> {
    let doc = ctx
        .db
        .proposal_source_doc()
        .id()
        .find(&doc_id)
        .ok_or_else(|| format!("Source doc {} not found", doc_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&doc.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", doc.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let name = params.name.unwrap_or_else(|| doc.name.clone());
    let content = params.content.unwrap_or_else(|| doc.content.clone());
    let doc_type = params.doc_type.unwrap_or_else(|| doc.doc_type.clone());
    let word_count = params.word_count.unwrap_or(doc.word_count);

    let old_values_json = json!({
        "name": doc.name,
        "word_count": doc.word_count,
    })
    .to_string();

    let new_row = ProposalSourceDoc {
        name,
        content,
        doc_type,
        word_count,
        ..doc
    };

    let new_values_json = json!({
        "name": new_row.name,
        "word_count": new_row.word_count,
    })
    .to_string();

    ctx.db.proposal_source_doc().id().update(new_row);

    write_audit_log_v2(
        ctx,
        proposal.organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "proposal_source_doc",
            record_id: doc_id,
            action: "UPDATE",
            old_values: Some(old_values_json),
            new_values: Some(new_values_json),
            changed_fields: vec![
                "name".to_string(),
                "content".to_string(),
                "doc_type".to_string(),
                "word_count".to_string(),
            ],
            metadata: None,
        },
    );

    Ok(())
}

// ============================================================================
// LINE ITEM REDUCERS
// ============================================================================

/// Add an ERP product/service as a line item on a proposal section
#[reducer]
pub fn add_proposal_line_item(
    ctx: &ReducerContext,
    proposal_id: u64,
    section_id: Option<u64>,
    product_id: u64,
    product_name: String,
    quantity: f64,
    price_unit: f64,
    discount: f64,
    notes: Option<String>,
) -> Result<(), String> {
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let subtotal = quantity * price_unit * (1.0 - discount / 100.0);

    // Sequence = current max + 10
    let sequence = ctx
        .db
        .proposal_line_item()
        .line_item_by_proposal()
        .filter(&proposal_id)
        .map(|item| item.sequence)
        .max()
        .unwrap_or(0)
        + 10;

    ctx.db.proposal_line_item().insert(ProposalLineItem {
        id: 0,
        organization_id: proposal.organization_id,
        proposal_id,
        section_id,
        product_id,
        product_name,
        product_variant_id: None,
        description: None,
        quantity,
        price_unit,
        subtotal,
        discount,
        sequence,
        notes,
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
    });

    Ok(())
}

/// Update a proposal line item (quantity, price, discount, notes)
#[reducer]
pub fn update_proposal_line_item(
    ctx: &ReducerContext,
    line_item_id: u64,
    quantity: f64,
    price_unit: f64,
    discount: f64,
    notes: Option<String>,
) -> Result<(), String> {
    let item = ctx
        .db
        .proposal_line_item()
        .id()
        .find(&line_item_id)
        .ok_or_else(|| format!("Line item {} not found", line_item_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&item.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", item.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    let subtotal = quantity * price_unit * (1.0 - discount / 100.0);

    ctx.db.proposal_line_item().id().update(ProposalLineItem {
        quantity,
        price_unit,
        subtotal,
        discount,
        notes,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..item
    });

    Ok(())
}

/// Delete a proposal line item
#[reducer]
pub fn delete_proposal_line_item(ctx: &ReducerContext, line_item_id: u64) -> Result<(), String> {
    let item = ctx
        .db
        .proposal_line_item()
        .id()
        .find(&line_item_id)
        .ok_or_else(|| format!("Line item {} not found", line_item_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&item.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", item.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_line_item().id().delete(&line_item_id);

    Ok(())
}

/// Reorder proposal line items by assigning new sequence values
#[reducer]
pub fn reorder_proposal_line_items(
    ctx: &ReducerContext,
    proposal_id: u64,
    ordered_ids: Vec<u64>,
) -> Result<(), String> {
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

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

// ============================================================================
// PRESENCE REDUCERS
// ============================================================================

/// Update (upsert) the caller's presence in a proposal workspace
#[reducer]
pub fn update_proposal_presence(
    ctx: &ReducerContext,
    proposal_id: u64,
    section_id: Option<u64>,
    user_name: String,
) -> Result<(), String> {
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    // Find existing presence row for this user + proposal
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
            organization_id: proposal.organization_id,
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

/// Remove the caller's presence from a proposal workspace
#[reducer]
pub fn clear_proposal_presence(ctx: &ReducerContext, proposal_id: u64) -> Result<(), String> {
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

// ============================================================================
// COMMENT REDUCERS
// ============================================================================

/// Add a threaded comment to a proposal section
#[reducer]
pub fn add_proposal_comment(
    ctx: &ReducerContext,
    proposal_id: u64,
    section_id: u64,
    content: String,
    parent_id: Option<u64>,
    author_name: String,
) -> Result<(), String> {
    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    if content.trim().is_empty() {
        return Err("Comment content cannot be empty".to_string());
    }

    ctx.db.proposal_comment().insert(ProposalComment {
        id: 0,
        organization_id: proposal.organization_id,
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

    Ok(())
}

/// Mark a proposal comment as resolved
#[reducer]
pub fn resolve_proposal_comment(ctx: &ReducerContext, comment_id: u64) -> Result<(), String> {
    let comment = ctx
        .db
        .proposal_comment()
        .id()
        .find(&comment_id)
        .ok_or_else(|| format!("Comment {} not found", comment_id))?;

    let proposal = ctx
        .db
        .proposal()
        .id()
        .find(&comment.proposal_id)
        .ok_or_else(|| format!("Proposal {} not found", comment.proposal_id))?;

    check_permission(ctx, proposal.organization_id, "proposal", "write")?;

    ctx.db.proposal_comment().id().update(ProposalComment {
        is_resolved: true,
        resolved_by: Some(ctx.sender()),
        write_date: ctx.timestamp,
        ..comment
    });

    Ok(())
}
