"""One-shot verified edits for the current WhatsApp candidate; not runtime code."""
import json
import re
from pathlib import Path

root = Path("frontend/web/app/(modules)/crm")
translations = {}
pattern = re.compile(r't\(\s*"(crm\.whatsapp\.[^"\\]+)"\s*,\s*"((?:\\.|[^"\\])*)"')
for name in ["crm-inbox-panel.tsx", "whatsapp-dispatch-action.tsx", "whatsapp-triage-panel.tsx"]:
    for key, encoded in pattern.findall((root / name).read_text()):
        value = json.loads('"' + encoded + '"')
        short = key.removeprefix("crm.whatsapp.")
        if short in translations and translations[short] != value:
            raise RuntimeError("conflicting WhatsApp translation defaults")
        translations[short] = value
assert len(translations) >= 25, "expected the complete new WhatsApp vocabulary"
locale = Path("frontend/packages/i18n/src/locales/en.json")
value = json.loads(locale.read_text())
value["crm"].setdefault("whatsapp", {}).update(translations)
locale.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

path = Path("spacetimedb/src/crm/inbox_dispatch.rs")
source = path.read_text()
marker = "fn select_sender(candidates: &[(u64, bool, bool)])"
assert source.count(marker) == 1
source = source.replace(marker, '''fn company_scope_allows(assigned: Option<u64>, target: u64) -> bool {
    target > 0 && assigned.is_none_or(|company| company == target)
}

fn select_sender(candidates: &[(u64, bool, bool)])''')
marker = "    let account = load_active_provider_account(ctx, organization_id, account_id)?;"
assert source.count(marker) == 1
source = source.replace(marker, '''    let membership = ctx
        .db
        .user_organization()
        .user_org_by_user()
        .filter(&ctx.sender())
        .find(|member| member.organization_id == organization_id && member.is_active)
        .ok_or("active organization membership is required to queue provider messages")?;
    if !company_scope_allows(membership.company_id, company_id) {
        return Err("provider message company is outside the actor's membership".into());
    }
    let account = load_active_provider_account(ctx, organization_id, account_id)?;''')
source += '''
#[cfg(test)]
mod company_scope_tests {
    use super::company_scope_allows;

    #[test]
    fn native_provider_queue_scope_cannot_cross_company_membership() {
        assert!(company_scope_allows(None, 3));
        assert!(company_scope_allows(Some(3), 3));
        assert!(!company_scope_allows(Some(2), 3));
        assert!(!company_scope_allows(None, 0));
    }
}
'''
path.write_text(source)

path = Path("api-server/src/routes/whatsapp_meta/operator/source.rs")
source = path.read_text()
assert "fn message_body" in source
source += '''
#[cfg(test)]
mod message_content_tests {
    use super::message_body;
    use serde_json::json;

    #[test]
    fn message_content_is_not_limited_to_provider_identifier_length() {
        let normal = json!({"body": "x".repeat(1000)});
        assert_eq!(message_body(&normal, "body").unwrap().len(), 1000);
        assert!(message_body(&json!({"body": "x".repeat(4001)}), "body").is_err());
        assert!(message_body(&json!({"body": "💡".repeat(1100)}), "body").is_err());
        assert!(message_body(&json!({"body": null}), "body").is_err());
        assert!(message_body(&json!({}), "body").is_err());
    }
}
'''
path.write_text(source)

path = Path("api-server/src/routes/whatsapp_meta/outbound/claim_tests.rs")
source = path.read_text()
source += '''
#[tokio::test]
#[ignore = "requires WHATSAPP_TEST_PG=1 and a local *_whatsapp_test database"]
async fn postgres_late_callbacks_never_extend_the_window_or_clear_stop() -> Result<()> {
    let (pool, message) = fixture().await?;
    let original = chrono::Utc::now().timestamp() - 60;
    let raw = json!({"id":"wamid.window","from":message.recipient,"type":"text",
        "text":{"body":"Hello"},"timestamp":original.to_string()});
    let mut event = Incoming {
        organization_id: message.organization_id, account_id: 2, company_id: Some(3),
        business_account_id: "123".into(), phone_number_id: "456".into(), kind: "message".into(),
        event_key: event_key("message", &raw), fingerprint: fingerprint(&raw), payload: raw,
    };
    store::persist(&pool, &[event.clone()]).await?;
    store::persist(&pool, &[event.clone()]).await?;
    event.payload["id"] = json!("wamid.old-stop");
    event.payload["text"]["body"] = json!("STOP");
    event.payload["timestamp"] = json!((original - 172800).to_string());
    event.event_key = event_key("message", &event.payload);
    event.fingerprint = fingerprint(&event.payload);
    store::persist(&pool, &[event.clone()]).await?;
    // A conflicting provider event is quarantined, not admitted as new facts.
    event.payload["text"]["body"] = json!("Hello again");
    event.payload["timestamp"] = json!(chrono::Utc::now().timestamp().to_string());
    event.fingerprint = fingerprint(&event.payload);
    store::persist(&pool, &[event.clone()]).await?;
    let client = pool.get().await?;
    let row = client.query_one(
        "SELECT last_customer_seconds,stopped_at IS NOT NULL FROM lumiere_whatsapp.recipient_state \\
         WHERE organization_id=$1 AND account_id='2' AND recipient=$2",
        &[&message.organization_id.to_string(), &message.recipient],
    ).await?;
    assert_eq!(row.get::<_, i64>(0), original);
    assert!(row.get::<_, bool>(1), "a delayed event must not clear STOP");
    client.execute("DELETE FROM lumiere_whatsapp.inbox WHERE organization_id=$1",
        &[&message.organization_id.to_string()]).await?;
    client.execute("DELETE FROM lumiere_whatsapp.recipient_state WHERE organization_id=$1",
        &[&message.organization_id.to_string()]).await?;
    Ok(())
}
'''
path.write_text(source)
