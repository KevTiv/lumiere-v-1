/// Knowledge Base Module — Wiki-style articles and categories
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **KnowledgeArticleCategory** | Article categories |
/// | **KnowledgeArticle** | Wiki articles with hierarchy and access control |
use spacetimedb::{reducer, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log_v2, AuditLogParams};

// ============================================================================
// TABLES
// ============================================================================

/// Knowledge Article Category — Groups articles by topic
#[derive(Clone)]
#[spacetimedb::table(
    accessor = kb_category,
    public,
    index(accessor = kb_category_by_parent, btree(columns = [parent_id]))
)]
pub struct KnowledgeArticleCategory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub sequence: u32,
    pub color: Option<u8>,
    pub article_count: u32,
    pub parent_id: Option<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

/// Knowledge Article — A wiki-style article with hierarchy and permissions
#[derive(Clone)]
#[spacetimedb::table(
    accessor = knowledge_article,
    public,
    index(accessor = article_by_parent, btree(columns = [parent_id])),
    index(accessor = article_by_category, btree(columns = [category_id]))
)]
pub struct KnowledgeArticle {
    #[primary_key]
    #[auto_inc]
    pub id: u64,

    pub name: String,
    pub description: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub color: Option<u8>,
    pub sequence: u32,
    pub is_locked: bool,
    pub lock_by: Option<Identity>,
    pub lock_on: Option<Timestamp>,
    pub is_article_item: bool,
    pub is_article_root: bool,
    pub is_todo_item: bool,
    pub root_article_id: Option<u64>,
    pub parent_id: Option<u64>,
    pub child_ids: Vec<u64>,
    pub previous_article_id: Option<u64>,
    pub next_article_id: Option<u64>,
    pub has_item_children: bool,
    pub category_id: Option<u64>,
    pub favorite_ids: Vec<u64>,
    pub user_sequence: u32,
    pub article_url: Option<String>,
    pub stage_id: Option<u64>,
    pub member_ids: Vec<Identity>,
    pub article_member_count: u32,
    pub article_item_count: u32,
    pub article_count: u32,
    pub internal_permission: Option<String>,
    pub inherited_permission: Option<String>,
    pub inherited_permission_parent_id: Option<u64>,
    pub is_published: bool,
    pub website_url: Option<String>,
    pub activity_ids: Vec<u64>,
    pub message_follower_ids: Vec<u64>,
    pub message_ids: Vec<u64>,
    pub create_uid: Identity,
    pub create_date: Timestamp,
    pub write_uid: Identity,
    pub write_date: Timestamp,
    pub metadata: Option<String>,
}

// ============================================================================
// INPUT PARAMS
// ============================================================================

/// Params for creating a knowledge article category.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateKnowledgeCategoryParams {
    pub name: String,
    pub description: Option<String>,
    pub parent_id: Option<u64>,
    pub color: Option<u8>,
    pub sequence: u32,
    pub metadata: Option<String>,
}

/// Params for updating a knowledge article category.
/// Scope: `company_id` and `category_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateKnowledgeCategoryParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub color: Option<u8>,
    pub sequence: Option<u32>,
}

/// Params for creating a knowledge article.
/// Scope: `company_id` is a flat reducer param.
#[derive(SpacetimeType, Clone, Debug)]
pub struct CreateKnowledgeArticleParams {
    pub name: String,
    pub description: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub color: Option<u8>,
    pub parent_id: Option<u64>,
    pub category_id: Option<u64>,
    pub internal_permission: Option<String>,
    pub is_article_item: bool,
    pub is_todo_item: bool,
    pub sequence: u32,
    pub article_url: Option<String>,
    pub website_url: Option<String>,
    pub metadata: Option<String>,
}

/// Params for updating a knowledge article.
/// Scope: `company_id` and `article_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct UpdateKnowledgeArticleParams {
    pub name: Option<String>,
    pub description: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
    pub color: Option<u8>,
    pub category_id: Option<u64>,
    pub internal_permission: Option<String>,
    pub article_url: Option<String>,
    pub is_published: Option<bool>,
    pub website_url: Option<String>,
    pub metadata: Option<String>,
}

/// Params for setting article published status.
/// Scope: `company_id` and `article_id` are flat reducer params.
#[derive(SpacetimeType, Clone, Debug)]
pub struct SetArticlePublishedParams {
    pub is_published: bool,
    pub website_url: Option<String>,
}

// ============================================================================
// REDUCERS
// ============================================================================

/// Create an article category
#[reducer]
pub fn create_knowledge_category(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateKnowledgeCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article_category", "create")?;

    let cat = ctx
        .db
        .kb_category()
        .insert(KnowledgeArticleCategory {
            id: 0,
            name: params.name,
            description: params.description,
            sequence: params.sequence,
            color: params.color,
            article_count: 0,
            parent_id: params.parent_id,
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
            table_name: "knowledge_article_category",
            record_id: cat.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!("{{\"name\":\"{}\"}}", cat.name)),
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge category created: id={}", cat.id);
    Ok(())
}

/// Update an article category
#[reducer]
pub fn update_knowledge_category(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    category_id: u64,
    params: UpdateKnowledgeCategoryParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article_category", "write")?;

    let cat = ctx
        .db
        .kb_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    let mut changed_fields = Vec::new();

    let new_cat = KnowledgeArticleCategory {
        name: params.name.unwrap_or(cat.name.clone()),
        description: params.description.or(cat.description.clone()),
        color: params.color.or(cat.color),
        sequence: params.sequence.unwrap_or(cat.sequence),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..cat.clone()
    };

    if new_cat.name != cat.name {
        changed_fields.push("name");
    }
    if new_cat.description != cat.description {
        changed_fields.push("description");
    }
    if new_cat.color != cat.color {
        changed_fields.push("color");
    }
    if new_cat.sequence != cat.sequence {
        changed_fields.push("sequence");
    }

    ctx.db.kb_category().id().update(new_cat);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article_category",
            record_id: category_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed_fields.into_iter().map(|s| s.to_string()).collect(),
            metadata: None,
        },
    );

    log::info!("Knowledge category updated: id={}", category_id);
    Ok(())
}

/// Create a knowledge article
#[reducer]
pub fn create_knowledge_article(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    params: CreateKnowledgeArticleParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "create")?;

    let is_root = params.parent_id.is_none();

    let article = ctx.db.knowledge_article().insert(KnowledgeArticle {
        id: 0,
        name: params.name,
        description: params.description,
        body: params.body,
        icon: params.icon,
        color: params.color,
        sequence: params.sequence,
        is_locked: false,
        lock_by: None,
        lock_on: None,
        is_article_item: params.is_article_item,
        is_article_root: is_root,
        is_todo_item: params.is_todo_item,
        root_article_id: None, // Updated below if has parent
        parent_id: params.parent_id,
        child_ids: Vec::new(),
        previous_article_id: None,
        next_article_id: None,
        has_item_children: false,
        category_id: params.category_id,
        favorite_ids: Vec::new(),
        user_sequence: 0,
        article_url: params.article_url,
        stage_id: None,
        member_ids: vec![ctx.sender()],
        article_member_count: 1,
        article_item_count: 0,
        article_count: 0,
        internal_permission: params.internal_permission,
        inherited_permission: None,
        inherited_permission_parent_id: None,
        is_published: false,
        website_url: params.website_url,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: params.metadata,
    });

    // Wire up parent → child and resolve root
    if let Some(pid) = params.parent_id {
        if let Some(parent) = ctx.db.knowledge_article().id().find(&pid) {
            let root_id = parent.root_article_id.unwrap_or(parent.id);

            // Update root reference on new article
            ctx.db.knowledge_article().id().update(KnowledgeArticle {
                root_article_id: Some(root_id),
                ..article.clone()
            });

            // Add child to parent
            let mut child_ids = parent.child_ids.clone();
            child_ids.push(article.id);
            ctx.db.knowledge_article().id().update(KnowledgeArticle {
                child_ids,
                article_count: parent.article_count + 1,
                has_item_children: params.is_article_item || parent.has_item_children,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
        }
    }

    // Increment category article count
    if let Some(cid) = params.category_id {
        if let Some(cat) = ctx.db.kb_category().id().find(&cid) {
            ctx.db
                .kb_category()
                .id()
                .update(KnowledgeArticleCategory {
                    article_count: cat.article_count + 1,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..cat
                });
        }
    }

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article.id,
            action: "CREATE",
            old_values: None,
            new_values: Some(format!("{{\"name\":\"{}\"}}", article.name)),
            changed_fields: vec!["created".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge article created: id={}", article.id);
    Ok(())
}

/// Update article content and metadata
#[reducer]
pub fn update_knowledge_article(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
    params: UpdateKnowledgeArticleParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "write")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if article.is_locked && article.lock_by != Some(ctx.sender()) {
        return Err("Article is locked by another user".to_string());
    }

    let mut changed_fields = Vec::new();

    let new_article = KnowledgeArticle {
        name: params.name.unwrap_or(article.name.clone()),
        description: params.description.or(article.description.clone()),
        body: params.body.or(article.body.clone()),
        icon: params.icon.or(article.icon.clone()),
        color: params.color.or(article.color),
        category_id: params.category_id.or(article.category_id),
        internal_permission: params
            .internal_permission
            .or(article.internal_permission.clone()),
        article_url: params.article_url.or(article.article_url.clone()),
        is_published: params.is_published.unwrap_or(article.is_published),
        website_url: params.website_url.or(article.website_url.clone()),
        metadata: params.metadata.or(article.metadata.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article.clone()
    };

    if new_article.name != article.name {
        changed_fields.push("name");
    }
    if new_article.description != article.description {
        changed_fields.push("description");
    }
    if new_article.body != article.body {
        changed_fields.push("body");
    }
    if new_article.icon != article.icon {
        changed_fields.push("icon");
    }
    if new_article.color != article.color {
        changed_fields.push("color");
    }
    if new_article.category_id != article.category_id {
        changed_fields.push("category_id");
    }
    if new_article.internal_permission != article.internal_permission {
        changed_fields.push("internal_permission");
    }
    if new_article.article_url != article.article_url {
        changed_fields.push("article_url");
    }
    if new_article.is_published != article.is_published {
        changed_fields.push("is_published");
    }
    if new_article.website_url != article.website_url {
        changed_fields.push("website_url");
    }
    if new_article.metadata != article.metadata {
        changed_fields.push("metadata");
    }

    ctx.db.knowledge_article().id().update(new_article);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: None,
            new_values: None,
            changed_fields: changed_fields.into_iter().map(|s| s.to_string()).collect(),
            metadata: None,
        },
    );

    log::info!("Knowledge article updated: id={}", article_id);
    Ok(())
}

/// Lock an article for exclusive editing
#[reducer]
pub fn lock_knowledge_article(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "write")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if article.is_locked {
        return Err("Article is already locked".to_string());
    }

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        is_locked: true,
        lock_by: Some(ctx.sender()),
        lock_on: Some(ctx.timestamp),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: Some("{\"is_locked\":false}".to_string()),
            new_values: Some("{\"is_locked\":true}".to_string()),
            changed_fields: vec!["locked".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge article locked: id={}", article_id);
    Ok(())
}

/// Unlock an article
#[reducer]
pub fn unlock_knowledge_article(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "write")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if article.lock_by != Some(ctx.sender()) {
        check_permission(ctx, company_id, "knowledge_article", "admin")?;
    }

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        is_locked: false,
        lock_by: None,
        lock_on: None,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: Some("{\"is_locked\":true}".to_string()),
            new_values: Some("{\"is_locked\":false}".to_string()),
            changed_fields: vec!["unlocked".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge article unlocked: id={}", article_id);
    Ok(())
}

/// Publish or unpublish an article
#[reducer]
pub fn set_article_published(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
    params: SetArticlePublishedParams,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "publish")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    let old_published = article.is_published;

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        is_published: params.is_published,
        website_url: params.website_url.or(article.website_url.clone()),
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: Some(format!("{{\"is_published\":{}}}", old_published)),
            new_values: Some(format!("{{\"is_published\":{}}}", params.is_published)),
            changed_fields: vec![if params.is_published {
                "published".to_string()
            } else {
                "unpublished".to_string()
            }],
            metadata: None,
        },
    );

    log::info!(
        "Knowledge article publish state: id={}, published={}",
        article_id,
        params.is_published
    );
    Ok(())
}

/// Add a member to an article
#[reducer]
pub fn add_article_member(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
    member: Identity,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "write")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if article.member_ids.contains(&member) {
        return Ok(()); // Already a member
    }

    let mut member_ids = article.member_ids.clone();
    member_ids.push(member);
    let article_member_count = member_ids.len() as u32;

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        member_ids,
        article_member_count,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(format!("{{\"member_added\":\"{:?}\"}}", member)),
            changed_fields: vec!["member_added".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Member added to article: article={}, member={:?}",
        article_id,
        member
    );
    Ok(())
}

/// Remove a member from an article
#[reducer]
pub fn remove_article_member(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
    member: Identity,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "write")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if !article.member_ids.contains(&member) {
        return Ok(()); // Not a member
    }

    let member_ids: Vec<Identity> = article
        .member_ids
        .iter()
        .filter(|&&id| id != member)
        .copied()
        .collect();
    let article_member_count = member_ids.len() as u32;

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        member_ids,
        article_member_count,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "UPDATE",
            old_values: None,
            new_values: Some(format!("{{\"member_removed\":\"{:?}\"}}", member)),
            changed_fields: vec!["member_removed".to_string()],
            metadata: None,
        },
    );

    log::info!(
        "Member removed from article: article={}, member={:?}",
        article_id,
        member
    );
    Ok(())
}

/// Delete a knowledge article
#[reducer]
pub fn delete_knowledge_article(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    article_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "delete")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    if article.is_locked {
        return Err("Cannot delete a locked article".to_string());
    }

    // Decrement category article count if applicable
    if let Some(cid) = article.category_id {
        if let Some(cat) = ctx.db.kb_category().id().find(&cid) {
            ctx.db
                .kb_category()
                .id()
                .update(KnowledgeArticleCategory {
                    article_count: cat.article_count.saturating_sub(1),
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..cat
                });
        }
    }

    // Remove this article from parent's child_ids
    if let Some(pid) = article.parent_id {
        if let Some(parent) = ctx.db.knowledge_article().id().find(&pid) {
            let child_ids: Vec<u64> = parent
                .child_ids
                .iter()
                .filter(|&&id| id != article_id)
                .copied()
                .collect();
            let has_item_children = child_ids.iter().any(|&child_id| {
                ctx.db
                    .knowledge_article()
                    .id()
                    .find(&child_id)
                    .map(|c| c.is_article_item)
                    .unwrap_or(false)
            });
            ctx.db.knowledge_article().id().update(KnowledgeArticle {
                child_ids,
                article_count: parent.article_count.saturating_sub(1),
                has_item_children,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
        }
    }

    // Actually delete the article (not soft delete)
    ctx.db.knowledge_article().id().delete(&article_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article",
            record_id: article_id,
            action: "DELETE",
            old_values: Some(format!("{{\"name\":\"{}\"}}", article.name)),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge article deleted: id={}", article_id);
    Ok(())
}

/// Delete a knowledge article category
#[reducer]
pub fn delete_knowledge_category(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    category_id: u64,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article_category", "delete")?;

    let cat = ctx
        .db
        .kb_category()
        .id()
        .find(&category_id)
        .ok_or("Category not found")?;

    // Check if category has articles
    if cat.article_count > 0 {
        return Err("Cannot delete category with articles".to_string());
    }

    ctx.db
        .kb_category()
        .id()
        .delete(&category_id);

    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: Some(company_id),
            table_name: "knowledge_article_category",
            record_id: category_id,
            action: "DELETE",
            old_values: Some(format!("{{\"name\":\"{}\"}}", cat.name)),
            new_values: None,
            changed_fields: vec!["deleted".to_string()],
            metadata: None,
        },
    );

    log::info!("Knowledge category deleted: id={}", category_id);
    Ok(())
}
