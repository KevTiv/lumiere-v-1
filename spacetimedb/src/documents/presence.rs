//! Wave D — collaborative presence for documents and knowledge articles.

use spacetimedb::{reducer, Identity, ReducerContext, Table, Timestamp};

use crate::documents::documents::document;
use crate::documents::knowledge::knowledge_article;

#[derive(Clone)]
#[spacetimedb::table(
    accessor = document_presence,
    public,
    index(accessor = doc_presence_by_document, btree(columns = [document_id])),
    index(accessor = doc_presence_by_user, btree(columns = [user_id]))
)]
pub struct DocumentPresence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub document_id: u64,
    pub user_id: Identity,
    pub user_name: String,
    pub last_seen: Timestamp,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = knowledge_article_presence,
    public,
    index(accessor = article_presence_by_article, btree(columns = [article_id])),
    index(accessor = article_presence_by_user, btree(columns = [user_id]))
)]
pub struct KnowledgeArticlePresence {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub article_id: u64,
    pub user_id: Identity,
    pub user_name: String,
    pub last_seen: Timestamp,
}

#[reducer]
pub fn update_document_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    document_id: u64,
    user_name: String,
) -> Result<(), String> {
    let doc = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .ok_or("Document not found")?;
    if doc.organization_id != organization_id {
        return Err("Document does not belong to this organization".to_string());
    }

    let name = user_name.trim();
    let name = if name.is_empty() {
        "User".to_string()
    } else {
        name.to_string()
    };

    let existing = ctx
        .db
        .document_presence()
        .doc_presence_by_user()
        .filter(&ctx.sender())
        .find(|p| p.document_id == document_id);

    if let Some(row) = existing {
        ctx.db.document_presence().id().update(DocumentPresence {
            user_name: name,
            last_seen: ctx.timestamp,
            ..row
        });
    } else {
        ctx.db.document_presence().insert(DocumentPresence {
            id: 0,
            organization_id,
            document_id,
            user_id: ctx.sender(),
            user_name: name,
            last_seen: ctx.timestamp,
        });
    }
    Ok(())
}

#[reducer]
pub fn clear_document_presence(
    ctx: &ReducerContext,
    document_id: u64,
) -> Result<(), String> {
    let ids: Vec<u64> = ctx
        .db
        .document_presence()
        .doc_presence_by_user()
        .filter(&ctx.sender())
        .filter(|p| p.document_id == document_id)
        .map(|p| p.id)
        .collect();
    for id in ids {
        ctx.db.document_presence().id().delete(&id);
    }
    Ok(())
}

#[reducer]
pub fn update_knowledge_article_presence(
    ctx: &ReducerContext,
    organization_id: u64,
    article_id: u64,
    user_name: String,
) -> Result<(), String> {
    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&article_id)
        .ok_or("Knowledge article not found")?;
    if article.organization_id != organization_id {
        return Err("Article does not belong to this organization".to_string());
    }

    let name = user_name.trim();
    let name = if name.is_empty() {
        "User".to_string()
    } else {
        name.to_string()
    };

    let existing = ctx
        .db
        .knowledge_article_presence()
        .article_presence_by_user()
        .filter(&ctx.sender())
        .find(|p| p.article_id == article_id);

    if let Some(row) = existing {
        ctx.db
            .knowledge_article_presence()
            .id()
            .update(KnowledgeArticlePresence {
                user_name: name,
                last_seen: ctx.timestamp,
                ..row
            });
    } else {
        ctx.db
            .knowledge_article_presence()
            .insert(KnowledgeArticlePresence {
                id: 0,
                organization_id,
                article_id,
                user_id: ctx.sender(),
                user_name: name,
                last_seen: ctx.timestamp,
            });
    }
    Ok(())
}

#[reducer]
pub fn clear_knowledge_article_presence(
    ctx: &ReducerContext,
    article_id: u64,
) -> Result<(), String> {
    let ids: Vec<u64> = ctx
        .db
        .knowledge_article_presence()
        .article_presence_by_user()
        .filter(&ctx.sender())
        .filter(|p| p.article_id == article_id)
        .map(|p| p.id)
        .collect();
    for id in ids {
        ctx.db.knowledge_article_presence().id().delete(&id);
    }
    Ok(())
}

/// Clear all document/article presence rows for the disconnecting identity.
pub(crate) fn clear_all_presence_for_sender(ctx: &ReducerContext) {
    let doc_ids: Vec<u64> = ctx
        .db
        .document_presence()
        .doc_presence_by_user()
        .filter(&ctx.sender())
        .map(|p| p.id)
        .collect();
    for id in doc_ids {
        ctx.db.document_presence().id().delete(&id);
    }
    let article_ids: Vec<u64> = ctx
        .db
        .knowledge_article_presence()
        .article_presence_by_user()
        .filter(&ctx.sender())
        .map(|p| p.id)
        .collect();
    for id in article_ids {
        ctx.db.knowledge_article_presence().id().delete(&id);
    }
}
