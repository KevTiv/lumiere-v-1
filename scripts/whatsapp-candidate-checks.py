"""One-shot approved sender-binding wiring; remove after source formatting."""
from pathlib import Path

path = Path("api-server/src/routes/whatsapp_meta.rs")
source = path.read_text()
assert "mod connection;" not in source
assert source.count("mod inbound;") == 1
path.write_text(source.replace("mod inbound;", "mod connection;\nmod inbound;"))

path = Path("api-server/src/routes/whatsapp_meta/outbound/meta.rs")
source = path.read_text()
start = source.index("#[derive(Deserialize)]")
end = source.index("#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]", start)
wrapper = '''pub(crate) fn credential(
    organization: u64,
    account: u64,
    waba: &str,
    phone: &str,
    reference: &str,
) -> Result<String> {
    super::super::connection::credential(organization, account, waba, phone, reference)
}

'''
path.write_text(source[:start] + wrapper + source[end:])

path = Path("api-server/src/routes/whatsapp_meta/inbound.rs")
source = path.read_text()
start = source.index("    let sql = format!(", source.index("pub(super) async fn account("))
end = source.index("    let rows = state", start)
replacement = '''    let binding = super::connection::binding(waba, phone)
        .map_err(|_| ApiError::Unavailable("sender has no approved deployment binding".into()))?;
    let sql = format!(
        "SELECT * FROM whatsapp_business_account WHERE organization_id = {} AND id = {} LIMIT 2",
        binding.organization_id, binding.account_id
    );
'''
source = source[:start] + replacement + source[end:]
marker = "    if account.business_account_id != waba || account.phone_number_id != phone {"
assert source.count(marker) == 1
source = source.replace(marker, '''    if account.organization_id != binding.organization_id
        || account.account_id != binding.account_id
        || account.business_account_id != waba
        || account.phone_number_id != phone
        || text(&rows[0], "credentials_reference")? != binding.credentials_reference.as_str()
    {''')
path.write_text(source)

path = Path("docs/plans/whatsapp-meta-alpha-implementation.md")
source = path.read_text()
source += '''
## Server-approved sender ownership

Both incoming routing and outgoing credentials use the same deployment-owned enrollment array. A tenant-editable WhatsApp account row does not establish ownership of a WABA or receiving phone number. Signed provider assets must first match a unique provisioned organization/account/reference; only then is that exact account read and checked. Duplicate asset or account enrollments fail closed. Another tenant copying provider IDs into its settings cannot capture or reroute callbacks.

Provision the same enrollment mapping on the API and incoming worker. Missing enrollment produces a retryable failure rather than falling back to an unverified account-table scan. Credential rotation preserves exact ownership; changing the ownership binding quarantines already-received events instead of silently moving them to another organization.
'''
path.write_text(source)
