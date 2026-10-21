/// COV-19: `post_message` idempotency and exact-effect identity.
use spacetimedb::{ReducerContext, Table};

use crate::core::messaging::{mail_message, post_message, MailMessage};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

fn rows_for(ctx: &ReducerContext, organization_id: u64, res_id: u64) -> Vec<MailMessage> {
    ctx.db
        .mail_message()
        .iter()
        .filter(|m| {
            m.organization_id == organization_id && m.model == "cov19_record" && m.res_id == res_id
        })
        .collect()
}

pub fn test_post_message_idempotency(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let post = |res_id: u64, body: &str, key: Option<&str>| {
        post_message(
            ctx,
            org,
            "cov19_record".to_string(),
            res_id,
            body.to_string(),
            None,
            vec![],
            key.map(str::to_string),
        )
    };

    // A keyed post creates exactly one row that carries the key.
    post(1, "first", Some("cov19-key-a"))?;
    let created = rows_for(ctx, org, 1);
    if created.len() != 1 {
        return Err(format!(
            "keyed post created {} rows, expected 1",
            created.len()
        ));
    }
    let created = created.into_iter().next().unwrap();
    if created.author_id != ctx.sender() || created.body != "first" {
        return Err("keyed post did not record author and body".to_string());
    }
    let metadata = created
        .metadata
        .clone()
        .ok_or("keyed post left metadata empty")?;
    let stored: serde_json::Value = serde_json::from_str(&metadata).map_err(|e| e.to_string())?;
    if stored.get("idempotency_key").and_then(|v| v.as_str()) != Some("cov19-key-a") {
        return Err(format!("metadata does not carry the key: {metadata}"));
    }

    // Replay of the same submission converges: Ok, no new row, row unchanged.
    post(1, "first", Some("  cov19-key-a "))?;
    let after_replay = rows_for(ctx, org, 1);
    if after_replay.len() != 1 || after_replay[0] != created {
        return Err("replayed post duplicated or changed the message".to_string());
    }

    // The same key for a different message is rejected and creates nothing.
    for (res_id, body) in [(1, "different body"), (2, "first")] {
        match post(res_id, body, Some("cov19-key-a")) {
            Err(message) if message.contains("already used for a different message") => {}
            Err(message) => return Err(format!("unexpected conflict rejection: {message}")),
            Ok(()) => {
                return Err("re-using a key for a different message must be rejected".to_string())
            }
        }
    }
    if rows_for(ctx, org, 1).len() != 1 || !rows_for(ctx, org, 2).is_empty() {
        return Err("rejected key reuse created a message".to_string());
    }

    // Invalid keys are rejected before anything is written.
    for bad in ["", "   ", &"k".repeat(129)] {
        if post(3, "bad key", Some(bad)).is_ok() {
            return Err(format!(
                "invalid key of length {} must be rejected",
                bad.len()
            ));
        }
    }
    if !rows_for(ctx, org, 3).is_empty() {
        return Err("invalid key still created a message".to_string());
    }

    // Two different keys are two messages; without a key every call creates one.
    post(4, "same body", Some("cov19-key-b"))?;
    post(4, "same body", Some("cov19-key-c"))?;
    post(4, "same body", None)?;
    post(4, "same body", None)?;
    if rows_for(ctx, org, 4).len() != 4 {
        return Err("distinct keys and unkeyed posts must each create a message".to_string());
    }

    // Revoke current authority after the accepted operation. Neither replay,
    // key conflict, malformed business input, nor a fresh valid post may bypass
    // the current role check. Restore authority before returning to the suite.
    use crate::core::audit::audit_log;
    use crate::core::permissions::{role, Role};
    use crate::core::users::{
        find_user_profile_for_organization, user_organization, user_profile, UserProfile,
    };
    let profile = find_user_profile_for_organization(ctx, ctx.sender(), org)
        .ok_or("fixture profile missing")?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org && row.is_active)
        .ok_or("fixture membership missing")?;
    let current_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("fixture role missing")?;
    let messages_before: Vec<_> = ctx
        .db
        .mail_message()
        .iter()
        .filter(|row| row.organization_id == org)
        .collect();
    let audit_before: Vec<_> = ctx
        .db
        .audit_log()
        .iter()
        .filter(|row| row.organization_id == org)
        .map(|row| row.id)
        .collect();
    let restricted_profile = ctx
        .db
        .user_profile()
        .id()
        .find(&profile.id)
        .ok_or("fixture profile missing before restriction")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..restricted_profile
    });
    ctx.db.role().id().update(Role {
        permissions: vec![],
        ..current_role.clone()
    });
    let denied = [
        post(1, "first", Some("cov19-key-a")),       // accepted replay
        post(1, "conflicting", Some("cov19-key-a")), // stale key conflict
        post(5, "", Some("")),                       // invalid business input
        post(5, "fresh valid", Some("cov19-denied-fresh")), // valid new effect
        crate::crm::activities::complete_activity(ctx, org, u64::MAX),
        crate::inventory::tracking::reserve_serial(ctx, org, u64::MAX),
        crate::inventory::tracking::use_serial(ctx, org, u64::MAX),
        crate::sales::pos_transactions::close_pos_session(ctx, org, u64::MAX, 0.0),
        crate::inventory::stock::confirm_stock_picking(
            ctx,
            org,
            u64::MAX,
            crate::core::organization::CompanyScopeParams {
                company_id: Some(u64::MAX),
            },
        ),
        crate::inventory::stock::assign_stock_picking(
            ctx,
            org,
            u64::MAX,
            crate::core::organization::CompanyScopeParams {
                company_id: Some(u64::MAX),
            },
        ),
        crate::inventory::stock::validate_stock_picking(
            ctx,
            org,
            u64::MAX,
            crate::core::organization::CompanyScopeParams {
                company_id: Some(u64::MAX),
            },
        ),
        crate::inventory::stock::validate_stock_picking_backorder(
            ctx,
            org,
            u64::MAX,
            crate::core::organization::CompanyScopeParams {
                company_id: Some(u64::MAX),
            },
        ),
    ];
    ctx.db.user_profile().id().update(profile);
    ctx.db.role().id().update(current_role);
    for result in denied {
        match result {
            Err(error) if error.starts_with("Permission denied:") => {}
            other => return Err(format!("expected current permission denial, got {other:?}")),
        }
    }
    let messages_after: Vec<_> = ctx
        .db
        .mail_message()
        .iter()
        .filter(|row| row.organization_id == org)
        .collect();
    let audit_after: Vec<_> = ctx
        .db
        .audit_log()
        .iter()
        .filter(|row| row.organization_id == org)
        .map(|row| row.id)
        .collect();
    if messages_before != messages_after || audit_before != audit_after {
        return Err("denied calls changed canonical message or audit effects".to_string());
    }
    // Authorized replay behavior remains unchanged after the denial checks.
    post(1, "first", Some("cov19-key-a"))?;
    if rows_for(ctx, org, 1) != after_replay {
        return Err("authorized replay changed after current authority restoration".to_string());
    }
    Ok(())
}

fn insert_message(
    ctx: &ReducerContext,
    organization_id: u64,
    message_type: crate::types::MailMessageType,
    metadata: Option<String>,
) -> MailMessage {
    ctx.db.mail_message().insert(MailMessage {
        id: 0,
        organization_id,
        model: "cov19_notification".to_string(),
        res_id: 1,
        author_id: ctx.sender(),
        body: "New comment: hello".to_string(),
        message_type,
        subtype: Some("mail.mt_comment".to_string()),
        date: ctx.timestamp,
        parent_id: None,
        attachment_ids: vec![],
        metadata,
    })
}

fn stored_row(ctx: &ReducerContext, id: u64) -> Result<MailMessage, String> {
    ctx.db
        .mail_message()
        .id()
        .find(&id)
        .ok_or_else(|| format!("message {id} missing"))
}

fn read_at_of(row: &MailMessage) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_str(row.metadata.as_deref()?).ok()?;
    value.get("read_at")?.as_i64()
}

/// Notification read state: `mark_notification_read` / `mark_all_notifications_read`.
pub fn test_notification_read_state(ctx: &ReducerContext) -> Result<(), String> {
    use crate::core::messaging::{mark_all_notifications_read, mark_notification_read};
    use crate::core::permissions::{role, Role};
    use crate::core::users::{user_organization, user_profile, UserProfile};
    use crate::types::MailMessageType;

    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let me = ctx.sender().to_hex().to_string();
    let other = spacetimedb::Identity::from_byte_array([0x5a; 32])
        .to_hex()
        .to_string();
    let notification = |recipient: &str| {
        insert_message(
            ctx,
            org,
            MailMessageType::Notification,
            Some(serde_json::json!({ "recipient": recipient, "event": "comment" }).to_string()),
        )
    };

    // Narrow the fixture owner to read-only authority. This proves that
    // acknowledging a caller-owned notification does not require message
    // content write permission.
    let profile = ctx
        .db
        .user_profile()
        .user_profile_by_identity_organization()
        .filter((ctx.sender(), org))
        .next()
        .ok_or("test user profile missing")?;
    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|row| row.organization_id == org)
        .ok_or("test organization membership missing")?;
    let owner_role = ctx
        .db
        .role()
        .id()
        .find(&membership.role_id)
        .ok_or("test owner role missing")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: false,
        ..profile
    });
    ctx.db.role().id().update(Role {
        permissions: vec!["mail_message:read".to_string()],
        ..owner_role.clone()
    });

    // The recipient marks their own notification read; other keys survive.
    let mine = notification(&me);
    mark_notification_read(ctx, org, mine.id)?;
    let marked = stored_row(ctx, mine.id)?;
    let read_at = read_at_of(&marked).ok_or("read_at was not recorded")?;
    if read_at != ctx.timestamp.to_micros_since_unix_epoch() {
        return Err("read_at is not the call timestamp".to_string());
    }
    let stored: serde_json::Value =
        serde_json::from_str(marked.metadata.as_deref().ok_or("metadata empty")?)
            .map_err(|e| e.to_string())?;
    if stored.get("recipient").and_then(|v| v.as_str()) != Some(me.as_str())
        || stored.get("event").and_then(|v| v.as_str()) != Some("comment")
    {
        return Err("marking read dropped existing metadata keys".to_string());
    }

    // A second call is a no-op: Ok and the row is unchanged.
    mark_notification_read(ctx, org, mine.id)?;
    if stored_row(ctx, mine.id)? != marked {
        return Err("second mark_notification_read changed the row".to_string());
    }

    // Another user's notification cannot be marked, and stays unread.
    let theirs = notification(&other);
    match mark_notification_read(ctx, org, theirs.id) {
        Err(message) if message.contains("not addressed to the caller") => {}
        outcome => {
            return Err(format!(
                "foreign notification must be rejected: {outcome:?}"
            ))
        }
    }
    if stored_row(ctx, theirs.id)? != theirs {
        return Err("rejected mark changed a foreign notification".to_string());
    }

    // A non-notification message is rejected even if its metadata names the caller.
    let comment = insert_message(
        ctx,
        org,
        MailMessageType::Comment,
        Some(serde_json::json!({ "recipient": me }).to_string()),
    );
    match mark_notification_read(ctx, org, comment.id) {
        Err(message) if message.contains("not a notification") => {}
        outcome => return Err(format!("non-notification must be rejected: {outcome:?}")),
    }
    if stored_row(ctx, comment.id)? != comment {
        return Err("rejected mark changed a non-notification".to_string());
    }
    if mark_notification_read(ctx, org, u64::MAX).is_ok() {
        return Err("unknown message id must be rejected".to_string());
    }

    // mark-all only touches the caller's unread notifications.
    let unread_a = notification(&me);
    let unread_b = notification(&me);
    let foreign = notification(&other);
    mark_all_notifications_read(ctx, org)?;
    for row in [&unread_a, &unread_b] {
        if read_at_of(&stored_row(ctx, row.id)?).is_none() {
            return Err("mark_all left an own notification unread".to_string());
        }
    }
    if stored_row(ctx, foreign.id)? != foreign || stored_row(ctx, theirs.id)? != theirs {
        return Err("mark_all touched another user's notification".to_string());
    }
    if stored_row(ctx, comment.id)? != comment {
        return Err("mark_all touched a non-notification".to_string());
    }
    if stored_row(ctx, mine.id)? != marked {
        return Err("mark_all rewrote an already-read notification".to_string());
    }

    // Idempotent: a second mark-all changes nothing.
    let after_first = [stored_row(ctx, unread_a.id)?, stored_row(ctx, unread_b.id)?];
    mark_all_notifications_read(ctx, org)?;
    if stored_row(ctx, unread_a.id)? != after_first[0]
        || stored_row(ctx, unread_b.id)? != after_first[1]
    {
        return Err("second mark_all_notifications_read changed rows".to_string());
    }
    ctx.db.role().id().update(owner_role);
    let narrowed_profile = ctx
        .db
        .user_profile()
        .user_profile_by_identity_organization()
        .filter((ctx.sender(), org))
        .next()
        .ok_or("test user profile missing after notification checks")?;
    ctx.db.user_profile().id().update(UserProfile {
        is_superuser: true,
        ..narrowed_profile
    });
    Ok(())
}
