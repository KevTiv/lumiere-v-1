//! Runtime lifecycle regression for company-scoped assistant guide revisions.
use crate::documents::knowledge::{
    knowledge_article, update_knowledge_article, UpdateKnowledgeArticleParams,
};
use crate::documents::knowledge_guides::{
    knowledge_guide, knowledge_guide_revision, save_knowledge_guide_inner, SaveKnowledgeGuideParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use spacetimedb::{ReducerContext, Table};

pub fn lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let company = fixture.company_id;
    let original = SaveKnowledgeGuideParams {
        guide_id: None,
        expected_revision: None,
        request_key: "guide-create".into(),
        draft_key: "draft-1".into(),
        title: "Sensitive bill explanation".into(),
        module: "accounting".into(),
        workflow: Some("vendor-bills".into()),
        markdown: "Original private text".into(),
        html: None,
        language: "en".into(),
        workflow_version: None,
        sources_json: "[]".into(),
        origin_message_id: None,
        origin_run_id: None,
    };
    save_knowledge_guide_inner(ctx, org, company, original.clone())?;
    let head = ctx
        .db
        .knowledge_guide()
        .knowledge_guide_by_org()
        .filter(&org)
        .next()
        .ok_or("guide head missing")?;
    let article = ctx
        .db
        .knowledge_article()
        .id()
        .find(&head.id)
        .ok_or("library shell missing")?;
    if article.body.is_some() || article.name.contains("Sensitive") || article.is_published {
        return Err("private guide leaked through public article shell".into());
    }
    save_knowledge_guide_inner(ctx, org, company, original.clone())?;
    if ctx
        .db
        .knowledge_guide_revision()
        .knowledge_guide_revision_by_guide()
        .filter(&head.id)
        .count()
        != 1
    {
        return Err("save retry duplicated guide revision".into());
    }
    let mut changed_key = original.clone();
    changed_key.markdown = "Different request".into();
    if save_knowledge_guide_inner(ctx, org, company, changed_key).is_ok() {
        return Err("reused request key accepted changed content".into());
    }
    let mut update = original.clone();
    update.guide_id = Some(head.id);
    update.expected_revision = Some(1);
    update.request_key = "guide-update".into();
    update.markdown = "Second revision".into();
    save_knowledge_guide_inner(ctx, org, company, update.clone())?;
    save_knowledge_guide_inner(ctx, org, company, update.clone())?;
    update.request_key = "stale-update".into();
    if save_knowledge_guide_inner(ctx, org, company, update).is_ok() {
        return Err("stale revision overwrote guide".into());
    }
    let revisions: Vec<_> = ctx
        .db
        .knowledge_guide_revision()
        .knowledge_guide_revision_by_guide()
        .filter(&head.id)
        .collect();
    if revisions.len() != 2
        || !revisions
            .iter()
            .any(|r| r.revision == 1 && r.markdown == "Original private text")
    {
        return Err("old guide revision was modified".into());
    }
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let mut foreign_update = original;
    foreign_update.guide_id = Some(head.id);
    foreign_update.expected_revision = Some(2);
    foreign_update.request_key = "foreign-update".into();
    if save_knowledge_guide_inner(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        foreign_update,
    )
    .is_ok()
    {
        return Err("foreign scope accepted guide update".into());
    }
    let bypass = UpdateKnowledgeArticleParams {
        company_id: Some(company),
        name: Some("Bypass".into()),
        description: None,
        body: Some("Unversioned edit".into()),
        icon: None,
        color: None,
        category_id: None,
        internal_permission: None,
        article_url: None,
        is_published: None,
        website_url: None,
        metadata: None,
    };
    if update_knowledge_article(ctx, org, head.id, bypass).is_ok() {
        return Err("generic article operation bypassed guide revision owner".into());
    }
    Ok(())
}
