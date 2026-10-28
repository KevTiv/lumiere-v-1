//! Company-scoped assistant guides, owned by KnowledgeArticle and immutable revisions.
//!
//! Bodies stay in private tables. The public article is only a library entry;
//! its generic body/update path never becomes a second revision authority.

use sha2::{Digest, Sha256};
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::core::organization::require_company_in_organization;
use crate::core::users::user_organization;
use crate::documents::knowledge::{knowledge_article, KnowledgeArticle};
use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

#[derive(Clone)]
#[spacetimedb::table(
    accessor = knowledge_guide,
    index(accessor = knowledge_guide_by_org, btree(columns = [organization_id])),
    index(accessor = knowledge_guide_by_company, btree(columns = [organization_id, company_id]))
)]
pub struct KnowledgeGuide {
    #[primary_key]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub module: String,
    pub workflow: Option<String>,
    pub latest_revision: u32,
    pub review_state: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_date: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = knowledge_guide_revision,
    index(accessor = knowledge_guide_revision_by_guide, btree(columns = [guide_id])),
    index(accessor = knowledge_guide_revision_by_org, btree(columns = [organization_id]))
)]
pub struct KnowledgeGuideRevision {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub company_id: u64,
    pub guide_id: u64,
    pub revision: u32,
    pub title: String,
    pub markdown: String,
    pub html: Option<String>,
    pub language: String,
    pub workflow_version: Option<String>,
    pub draft_key: String,
    pub sources_json: String,
    /// Associations supplied by a user are not evidence or execution authority.
    pub origin_message_id: Option<String>,
    pub origin_run_id: Option<String>,
    pub content_hash: String,
    pub request_key: String,
    pub request_hash: String,
    pub create_uid: Identity,
    pub create_date: Timestamp,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct SaveKnowledgeGuideParams {
    pub guide_id: Option<u64>,
    pub expected_revision: Option<u32>,
    pub request_key: String,
    pub draft_key: String,
    pub title: String,
    pub module: String,
    pub workflow: Option<String>,
    pub markdown: String,
    pub html: Option<String>,
    pub language: String,
    pub workflow_version: Option<String>,
    pub sources_json: String,
    pub origin_message_id: Option<String>,
    pub origin_run_id: Option<String>,
}

fn bounded(value: &str, max: usize, required: bool, label: &str) -> Result<(), String> {
    if value.len() > max || (required && value.trim().is_empty()) {
        return Err(format!("invalid guide {label}"));
    }
    Ok(())
}

fn identifier(value: &str, label: &str) -> Result<(), String> {
    bounded(value, 120, true, label)?;
    if !value
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
    {
        return Err(format!("invalid guide {label}"));
    }
    Ok(())
}

fn validate(params: &SaveKnowledgeGuideParams) -> Result<(), String> {
    identifier(&params.request_key, "request key")?;
    identifier(&params.draft_key, "draft key")?;
    identifier(&params.module, "module")?;
    bounded(&params.title, 240, true, "title")?;
    bounded(&params.markdown, 65_536, true, "body")?;
    bounded(&params.language, 35, true, "language")?;
    for (value, max, label) in [
        (params.html.as_deref(), 131_072, "HTML"),
        (params.workflow.as_deref(), 120, "workflow"),
        (params.workflow_version.as_deref(), 120, "workflow version"),
        (params.origin_message_id.as_deref(), 160, "message"),
        (params.origin_run_id.as_deref(), 80, "run"),
    ] {
        if let Some(value) = value {
            bounded(value, max, false, label)?;
        }
    }
    bounded(&params.sources_json, 32_768, false, "sources")?;
    let sources: serde_json::Value = serde_json::from_str(&params.sources_json)
        .map_err(|_| "invalid guide sources".to_string())?;
    if !sources
        .as_array()
        .is_some_and(|items| items.len() <= 30 && items.iter().all(serde_json::Value::is_object))
    {
        return Err("invalid guide sources".to_string());
    }
    if params.guide_id.is_some() != params.expected_revision.is_some()
        || params.expected_revision == Some(0)
    {
        return Err("guide update requires its expected revision".to_string());
    }
    Ok(())
}

fn require_company_membership(ctx: &ReducerContext, org: u64, company: u64) -> Result<(), String> {
    require_company_in_organization(ctx, org, company)?;
    if !ctx
        .db
        .user_organization()
        .user_org_by_org()
        .filter(&org)
        .any(|membership| {
            membership.user_identity == ctx.sender()
                && membership.is_active
                && (membership.company_id.is_none() || membership.company_id == Some(company))
        })
    {
        return Err("permission denied: guide company membership required".to_string());
    }
    Ok(())
}

fn require_member(ctx: &ReducerContext, article: &KnowledgeArticle) -> Result<(), String> {
    if !article.member_ids.contains(&ctx.sender()) {
        return Err("permission denied: guide membership required".to_string());
    }
    if article.is_locked && article.lock_by != Some(ctx.sender()) {
        return Err("guide is locked by another user".to_string());
    }
    Ok(())
}

/// Existing article membership/lock/delete operations remain the access owner,
/// but cannot be used by a non-member to take over a managed guide.
pub(crate) fn guard_article_access(
    ctx: &ReducerContext,
    article: &KnowledgeArticle,
) -> Result<(), String> {
    if let Some(guide) = ctx.db.knowledge_guide().id().find(&article.id) {
        require_company_membership(ctx, guide.organization_id, guide.company_id)?;
        if !article.member_ids.contains(&ctx.sender()) {
            return Err("permission denied: guide membership required".to_string());
        }
    }
    Ok(())
}

/// A guide's canonical text and review state can only change through its
/// revision owner, never through the legacy article editor/publish operation.
pub(crate) fn guard_article_content(ctx: &ReducerContext, article_id: u64) -> Result<(), String> {
    if ctx.db.knowledge_guide().id().find(&article_id).is_some() {
        return Err("managed guide content must be saved through guide revisions".to_string());
    }
    Ok(())
}

/// Save exactly one immutable guide revision. Repeated request keys return the
/// same effect only when their actor, scope, and complete payload agree.
#[reducer]
#[allow(clippy::too_many_arguments)]
pub fn save_knowledge_guide(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    guide_id: Option<u64>,
    expected_revision: Option<u32>,
    request_key: String,
    draft_key: String,
    title: String,
    module: String,
    workflow: Option<String>,
    markdown: String,
    html: Option<String>,
    language: String,
    workflow_version: Option<String>,
    sources_json: String,
    origin_message_id: Option<String>,
    origin_run_id: Option<String>,
) -> Result<(), String> {
    save_knowledge_guide_inner(
        ctx,
        organization_id,
        company_id,
        SaveKnowledgeGuideParams {
            guide_id,
            expected_revision,
            request_key,
            draft_key,
            title,
            module,
            workflow,
            markdown,
            html,
            language,
            workflow_version,
            sources_json,
            origin_message_id,
            origin_run_id,
        },
    )
}

pub(crate) fn save_knowledge_guide_inner(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: SaveKnowledgeGuideParams,
) -> Result<(), String> {
    validate(&params)?;
    require_company_membership(ctx, organization_id, company_id)?;
    check_permission(
        ctx,
        organization_id,
        "knowledge_article",
        if params.guide_id.is_some() {
            "write"
        } else {
            "create"
        },
    )?;
    let request_hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&params).map_err(|_| "invalid guide request")?,
    ));
    if let Some(prior) = ctx
        .db
        .knowledge_guide_revision()
        .knowledge_guide_revision_by_org()
        .filter(&organization_id)
        .find(|revision| {
            revision.company_id == company_id
                && revision.create_uid == ctx.sender()
                && revision.request_key == params.request_key
        })
    {
        let article = ctx
            .db
            .knowledge_article()
            .id()
            .find(&prior.guide_id)
            .ok_or("guide not found")?;
        require_member(ctx, &article)?;
        return if prior.request_hash == request_hash {
            Ok(())
        } else {
            Err("guide request key already used with different content".to_string())
        };
    }

    let (guide_id, next_revision, previous_head) = if let Some(guide_id) = params.guide_id {
        let head = ctx
            .db
            .knowledge_guide()
            .id()
            .find(&guide_id)
            .ok_or("guide not found")?;
        if head.organization_id != organization_id || head.company_id != company_id {
            return Err("permission denied: guide scope mismatch".to_string());
        }
        let article = ctx
            .db
            .knowledge_article()
            .id()
            .find(&guide_id)
            .ok_or("guide not found")?;
        require_member(ctx, &article)?;
        if params.expected_revision != Some(head.latest_revision) {
            return Err("guide revision conflict: reload before saving".to_string());
        }
        if params.module != head.module || params.workflow != head.workflow {
            return Err("guide module and workflow cannot change during a revision".to_string());
        }
        let next = head
            .latest_revision
            .checked_add(1)
            .ok_or("guide revision limit reached")?;
        (guide_id, next, Some(head))
    } else {
        // Keep content private. The ordinary KnowledgeArticle editor is not a
        // parallel editable copy and cannot reveal private historical bodies.
        let article = ctx.db.knowledge_article().insert(KnowledgeArticle {
            id: 0,
            organization_id,
            name: "Assistant guide".to_string(),
            description: None,
            body: None,
            icon: Some("book-open".to_string()),
            color: None,
            sequence: 10,
            is_locked: false,
            lock_by: None,
            lock_on: None,
            is_article_item: false,
            is_article_root: true,
            is_todo_item: false,
            root_article_id: None,
            parent_id: None,
            child_ids: vec![],
            previous_article_id: None,
            next_article_id: None,
            has_item_children: false,
            category_id: None,
            favorite_ids: vec![],
            user_sequence: 0,
            article_url: None,
            stage_id: None,
            member_ids: vec![ctx.sender()],
            article_member_count: 1,
            article_item_count: 0,
            article_count: 0,
            internal_permission: Some("private".to_string()),
            inherited_permission: None,
            inherited_permission_parent_id: None,
            is_published: false,
            website_url: None,
            activity_ids: vec![],
            message_follower_ids: vec![],
            message_ids: vec![],
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });
        (article.id, 1, None)
    };
    let content_hash = hex::encode(Sha256::digest(params.markdown.as_bytes()));
    ctx.db
        .knowledge_guide_revision()
        .insert(KnowledgeGuideRevision {
            id: 0,
            organization_id,
            company_id,
            guide_id,
            revision: next_revision,
            title: params.title.clone(),
            markdown: params.markdown,
            html: params.html,
            language: params.language,
            workflow_version: params.workflow_version,
            draft_key: params.draft_key,
            sources_json: params.sources_json,
            origin_message_id: params.origin_message_id,
            origin_run_id: params.origin_run_id,
            content_hash,
            request_key: params.request_key,
            request_hash,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
        });
    if let Some(head) = previous_head {
        ctx.db.knowledge_guide().id().update(KnowledgeGuide {
            latest_revision: next_revision,
            review_state: "draft".to_string(),
            write_date: ctx.timestamp,
            ..head
        });
    } else {
        ctx.db.knowledge_guide().insert(KnowledgeGuide {
            id: guide_id,
            organization_id,
            company_id,
            module: params.module,
            workflow: params.workflow,
            latest_revision: next_revision,
            review_state: "draft".to_string(),
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_date: ctx.timestamp,
        });
    }
    if let Some(article) = ctx.db.knowledge_article().id().find(&guide_id) {
        ctx.db.knowledge_article().id().update(KnowledgeArticle {
            name: "Assistant guide".to_string(),
            body: None,
            is_published: false,
            article_url: Some(format!("/documents/knowledge/{guide_id}")),
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            ..article
        });
    }
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_guide",
            record_id: guide_id,
            action: if next_revision == 1 {
                "CREATE"
            } else {
                "UPDATE"
            },
            old_values: None,
            new_values: Some(format!("{{\"revision\":{next_revision}}}")),
            changed_fields: vec!["revision".to_string()],
            metadata: None,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> SaveKnowledgeGuideParams {
        SaveKnowledgeGuideParams {
            guide_id: None,
            expected_revision: None,
            request_key: "save-1".into(),
            draft_key: "draft-1".into(),
            title: "Posting a bill".into(),
            module: "accounting".into(),
            workflow: None,
            markdown: "# Check the bill".into(),
            html: None,
            language: "en".into(),
            workflow_version: None,
            sources_json: "[]".into(),
            origin_message_id: None,
            origin_run_id: None,
        }
    }

    #[test]
    fn update_requires_exact_expected_revision() {
        let mut p = params();
        p.guide_id = Some(1);
        assert!(validate(&p).is_err());
        p.expected_revision = Some(1);
        assert!(validate(&p).is_ok());
        p.expected_revision = Some(0);
        assert!(validate(&p).is_err());
    }

    #[test]
    fn content_and_source_bounds_are_enforced() {
        let mut p = params();
        p.markdown = "x".repeat(65_537);
        assert!(validate(&p).is_err());
        p.markdown = "valid".into();
        p.sources_json = "{}".into();
        assert!(validate(&p).is_err());
        p.sources_json = "[1]".into();
        assert!(validate(&p).is_err());
        p.sources_json = "[]".into();
        p.module = "../other".into();
        assert!(validate(&p).is_err());
    }
}
