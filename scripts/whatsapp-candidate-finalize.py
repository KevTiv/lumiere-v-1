"""Temporary exact-source edits for the WhatsApp candidate; remove after formatting."""
from pathlib import Path


def replace(path: str, before: str, after: str, count: int = 1) -> None:
    file = Path(path)
    source = file.read_text()
    actual = source.count(before)
    if actual != count:
        if after in source and actual == 0:
            return
        raise RuntimeError(f"unexpected source for {path}: expected {count}, got {actual}")
    file.write_text(source.replace(before, after))


source = "api-server/src/routes/whatsapp_meta/operator/source.rs"
replace(source, "    pub sender_name: String,", "    pub sender_name: String,\n    pub body: String,")
replace(source, 'fn id(row: &Value, key: &str) -> Result<u64, ApiError> {', '''fn message_body<'a>(row: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    field(row, key)
        .and_then(Value::as_str)
        .filter(|body| !body.trim().is_empty() && body.len() <= 4000)
        .ok_or_else(|| ApiError::Forbidden("message content is unavailable or exceeds its limit".into()))
}

fn id(row: &Value, key: &str) -> Result<u64, ApiError> {''')
# Content uses its own byte limit, not the provider-identifier helper's 255 bytes.
p = Path(source)
s = p.read_text()
s = s.replace('text(&message, "body")?', 'message_body(&message, "body")?')
s = s.replace('text(&operational, "rendered_body")?', 'message_body(&operational, "rendered_body")?')
p.write_text(s)
replace(source, "    let message = ReviewedMessage {", "    let body = message_body(&message, \"body\")?.to_owned();\n    let message = ReviewedMessage {")
replace(source, "message, eligibility, digest, token, sender_name, masked_recipient, daily_limit, templates,", "message, eligibility, digest, token, sender_name, body, masked_recipient, daily_limit, templates,")

operator = "api-server/src/routes/whatsapp_meta/operator.rs"
p = Path(operator)
s = p.read_text()
start = s.index("    let body = match &source.message.content {", s.index("async fn preview("))
end = s.index("    Ok(Json(json!({", start)
s = s[:start] + "    let body = source.body.clone();\n" + s[end:]
s = s.replace("    let window_open = source.eligibility.last_customer_message_seconds\n        .is_some_and(|last| last <= now_seconds() && now_seconds() - last < 86400);", "    let now = now_seconds();\n    let window_open = source.eligibility.last_customer_message_seconds\n        .is_some_and(|last| last <= now && now - last < 86400);")
s = s.replace('"companyId":"1","choice":{"mode":"reply","actorCanSend":true}', '"companyId":"1","choice":{"mode":"reply"},"actorCanSend":true')
p.write_text(s)

ui = "frontend/web/app/(modules)/crm/whatsapp-dispatch-action.tsx"
replace(ui, "    const controller = new AbortController()\n    setError(null)", "    const controller = new AbortController()\n    setOptions(null)\n    setError(null)")
replace(ui, 'setParameters(Array(options.templates.find((item) => item.id === event.target.value)?.parameterCount ?? 0).fill(""))', 'setParameters(Array.from({ length: options.templates.find((item) => item.id === event.target.value)?.parameterCount ?? 0 }, () => ""))')
replace(ui, '{(attempted || (options && options.transport.state !== "not_attempted")) &&', '{(attempted || status !== null || (options && options.transport.state !== "not_attempted")) &&')
replace(ui, '        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshStatus()}>{t("crm.whatsapp.refreshStatus", "Refresh status without resending")}</Button>\n', '')
replace(ui, '      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setReview(null); setOpen(false) }}>', '      <Button size="sm" variant="outline" disabled={busy} onClick={() => void refreshStatus()}>{t("crm.whatsapp.refreshStatus", "Refresh status without resending")}</Button>\n      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setReview(null); setOpen(false) }}>')

runtime = "Dockerfile.rust-runtime"
replace(runtime, "      --bin workflow-worker \\\n", "      --bin workflow-worker \\\n      --bin whatsapp-inbox-worker \\\n", 2)
replace(runtime, "      target/release/workflow-worker \\\n", "      target/release/workflow-worker \\\n      target/release/whatsapp-inbox-worker \\\n")
replace("scripts/lumiere-runtime-entrypoint.sh", "storage-migrate|workflow-worker)", "storage-migrate|workflow-worker|whatsapp-inbox-worker)")

# The permanent focused tests are appended without rewriting other main changes.
import json
package = Path("frontend/web/package.json")
value = json.loads(package.read_text())
test = "lib/whatsapp-dispatch.test.ts"
if test not in value["scripts"]["test:unit"]:
    value["scripts"]["test:unit"] += " " + test
    package.write_text(json.dumps(value, indent=2) + "\n")
