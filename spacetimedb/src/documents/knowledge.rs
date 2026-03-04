/// Knowledge Base Module — Wiki-style articles and categories
///
/// # Tables
/// | Table | Description |
/// |-------|-------------|
/// | **KnowledgeArticleCategory** | Article categories |
/// | **KnowledgeArticle** | Wiki articles with hierarchy and access control |
use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::helpers::{check_permission, write_audit_log};

// ============================================================================
// TABLES
// ============================================================================

/// Knowledge Article Category — Groups articles by topic
#[spacetimedb::table(
    accessor = knowledge_article_category,
    public,
    index(name = "by_parent", accessor = kb_category_by_parent, btree(columns = [parent_id]))
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
    index(name = "by_parent", accessor = article_by_parent, btree(columns = [parent_id])),
    index(name = "by_category", accessor = article_by_category, btree(columns = [category_id]))
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
// REDUCERS
// ============================================================================

/// Create an article category
#[reducer]
pub fn create_knowledge_category(
    ctx: &ReducerContext,
    company_id: u64,
    name: String,
    description: Option<String>,
    parent_id: Option<u64>,
    color: Option<u8>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article_category", "create")?;

    let cat = ctx
        .db
        .knowledge_article_category()
        .insert(KnowledgeArticleCategory {
            id: 0,
            name,
            description,
            sequence: 0,
            color,
            article_count: 0,
            parent_id,
            create_uid: ctx.sender(),
            create_date: ctx.timestamp,
            write_uid: ctx.sender(),
            write_date: ctx.timestamp,
            metadata: None,
        });

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article_category",
        cat.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Knowledge category created: id={}", cat.id);
    Ok(())
}

/// Create a knowledge article
#[reducer]
pub fn create_knowledge_article(
    ctx: &ReducerContext,
    company_id: u64,
    name: String,
    body: Option<String>,
    parent_id: Option<u64>,
    category_id: Option<u64>,
    internal_permission: Option<String>,
    is_article_item: bool,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "create")?;

    let is_root = parent_id.is_none();

    let article = ctx.db.knowledge_article().insert(KnowledgeArticle {
        id: 0,
        name,
        description: None,
        body,
        icon: None,
        color: None,
        sequence: 0,
        is_locked: false,
        lock_by: None,
        lock_on: None,
        is_article_item,
        is_article_root: is_root,
        is_todo_item: false,
        root_article_id: None, // Updated below if has parent
        parent_id,
        child_ids: Vec::new(),
        previous_article_id: None,
        next_article_id: None,
        has_item_children: false,
        category_id,
        favorite_ids: Vec::new(),
        user_sequence: 0,
        article_url: None,
        stage_id: None,
        member_ids: vec![ctx.sender()],
        article_member_count: 1,
        article_item_count: 0,
        article_count: 0,
        internal_permission,
        inherited_permission: None,
        inherited_permission_parent_id: None,
        is_published: false,
        website_url: None,
        activity_ids: Vec::new(),
        message_follower_ids: Vec::new(),
        message_ids: Vec::new(),
        create_uid: ctx.sender(),
        create_date: ctx.timestamp,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        metadata: None,
    });

    // Wire up parent → child and resolve root
    if let Some(pid) = parent_id {
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
                has_item_children: is_article_item || parent.has_item_children,
                write_uid: ctx.sender(),
                write_date: ctx.timestamp,
                ..parent
            });
        }
    }

    // Increment category article count
    if let Some(cid) = category_id {
        if let Some(cat) = ctx.db.knowledge_article_category().id().find(&cid) {
            ctx.db
                .knowledge_article_category()
                .id()
                .update(KnowledgeArticleCategory {
                    article_count: cat.article_count + 1,
                    write_uid: ctx.sender(),
                    write_date: ctx.timestamp,
                    ..cat
                });
        }
    }

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article.id,
        "create",
        None,
        None,
        vec!["created".to_string()],
    );

    log::info!("Knowledge article created: id={}", article.id);
    Ok(())
}

/// Update article content
#[reducer]
pub fn update_knowledge_article(
    ctx: &ReducerContext,
    company_id: u64,
    article_id: u64,
    name: String,
    body: Option<String>,
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

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        name,
        body,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article_id,
        "write",
        None,
        None,
        vec!["updated".to_string()],
    );

    log::info!("Knowledge article updated: id={}", article_id);
    Ok(())
}

/// Lock an article for exclusive editing
#[reducer]
pub fn lock_knowledge_article(
    ctx: &ReducerContext,
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

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article_id,
        "write",
        None,
        None,
        vec!["locked".to_string()],
    );

    log::info!("Knowledge article locked: id={}", article_id);
    Ok(())
}

/// Unlock an article
#[reducer]
pub fn unlock_knowledge_article(
    ctx: &ReducerContext,
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

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article_id,
        "write",
        None,
        None,
        vec!["unlocked".to_string()],
    );

    log::info!("Knowledge article unlocked: id={}", article_id);
    Ok(())
}

/// Publish or unpublish an article
#[reducer]
pub fn set_article_published(
    ctx: &ReducerContext,
    company_id: u64,
    article_id: u64,
    is_published: bool,
    website_url: Option<String>,
) -> Result<(), String> {
    check_permission(ctx, company_id, "knowledge_article", "publish")?;

    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Article not found")?;

    ctx.db.knowledge_article().id().update(KnowledgeArticle {
        is_published,
        website_url,
        write_uid: ctx.sender(),
        write_date: ctx.timestamp,
        ..article
    });

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article_id,
        "write",
        None,
        None,
        vec![if is_published {
            "published".to_string()
        } else {
            "unpublished".to_string()
        }],
    );

    log::info!(
        "Knowledge article publish state: id={}, published={}",
        article_id,
        is_published
    );
    Ok(())
}

/// Add a member to an article
#[reducer]
pub fn add_article_member(
    ctx: &ReducerContext,
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

    write_audit_log(
        ctx,
        company_id,
        None,
        "knowledge_article",
        article_id,
        "write",
        None,
        None,
        vec!["member_added".to_string()],
    );

    log::info!(
        "Member added to article: article={}, member={:?}",
        article_id,
        member
    );
    Ok(())
}
