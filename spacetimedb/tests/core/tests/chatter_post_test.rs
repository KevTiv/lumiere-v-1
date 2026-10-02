//! COV-19: `post_message` writes exactly one scoped comment per call.
use spacetimedb::{ReducerContext, Table};

use crate::core::messaging::{mail_message, post_message};
use crate::test_harness::{ensure_test_superuser, OrgFixture};
use crate::types::MailMessageType;

/// A post persists one comment for the exact organization, model and record, authored by
/// the caller; invalid posts persist nothing; posts are not deduplicated (an identical body
/// is a second, distinct message) and never appear under another organization.
pub fn test_post_message_persists_one_scoped_row(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let local = OrgFixture::seed_minimal(ctx)?;
    let other = OrgFixture::seed_minimal(ctx)?;
    let count = |ctx: &ReducerContext, organization_id: u64| {
        ctx.db
            .mail_message()
            .iter()
            .filter(|m| {
                m.organization_id == organization_id && m.model == "sale_order" && m.res_id == 77
            })
            .count()
    };

    post_message(
        ctx,
        local.organization_id,
        "sale_order".to_string(),
        77,
        "COV-19 first".to_string(),
        None,
        vec![],
    )?;
    let rows = ctx
        .db
        .mail_message()
        .iter()
        .filter(|m| {
            m.organization_id == local.organization_id && m.model == "sale_order" && m.res_id == 77
        })
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err(format!("expected one message, got {}", rows.len()));
    }
    let first = &rows[0];
    if first.body != "COV-19 first"
        || first.author_id != ctx.sender()
        || first.parent_id.is_some()
        || !matches!(first.message_type, MailMessageType::Comment)
    {
        return Err("posted message must carry its body, author and Comment type".into());
    }
    if count(ctx, other.organization_id) != 0 {
        return Err("a message must not appear under another organization".into());
    }

    for (model, body) in [("", "COV-19 invalid model"), ("sale_order", "")] {
        if post_message(
            ctx,
            local.organization_id,
            model.to_string(),
            77,
            body.to_string(),
            None,
            vec![],
        )
        .is_ok()
        {
            return Err(format!("post with model {model:?} and body {body:?} must be rejected"));
        }
    }
    if count(ctx, local.organization_id) != 1 {
        return Err("rejected posts persisted a message".into());
    }

    post_message(
        ctx,
        local.organization_id,
        "sale_order".to_string(),
        77,
        "COV-19 first".to_string(),
        None,
        vec![],
    )?;
    let after = ctx
        .db
        .mail_message()
        .iter()
        .filter(|m| {
            m.organization_id == local.organization_id && m.model == "sale_order" && m.res_id == 77
        })
        .map(|m| m.id)
        .collect::<Vec<_>>();
    if after.len() != 2 || after[0] == after[1] {
        return Err("an identical body must post as a second distinct message".into());
    }
    Ok(())
}
