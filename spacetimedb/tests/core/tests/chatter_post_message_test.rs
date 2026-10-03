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
    Ok(())
}
