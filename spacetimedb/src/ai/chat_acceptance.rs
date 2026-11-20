//! The private registry for grounded chat release fixtures.
//! It contains test references and assertions. Authentication is owned by the
//! release runner and never belongs to these rows.

use serde_json::{Map, Value};
use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use super::evidence_source::{ai_evidence_passage, TEXT_PRESENT};
use super::platform_defaults::require_platform;
use crate::core::organization::{company, default_company_id_for_organization, organization};
use crate::documents::documents::{document, document_version};
use crate::helpers::{write_audit_log_v2, AuditLogParams};

const MAX_FIXTURE_BYTES: usize = 32 * 1024;
const MAX_TEXT_BYTES: usize = 4 * 1024;
const MAX_SAFE_JSON_ID: u64 = (1 << 53) - 1;

#[derive(Clone)]
#[spacetimedb::table(
    accessor = ai_chat_acceptance_fixture,
    index(accessor = ai_chat_acceptance_fixture_by_release,
        btree(columns = [organization_id, environment, release_sha])),
    index(accessor = ai_chat_acceptance_fixture_by_fresh_company, btree(columns = [fresh_company_id]))
)]
pub struct AiChatAcceptanceFixture {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub organization_id: u64,
    pub environment: String,
    /// Empty for the baseline. Exact release rows are immutable.
    pub release_sha: String,
    pub fixture_json: String,
    /// Zero for the baseline. Company IDs on exact releases are positive.
    pub fresh_company_id: u64,
    pub revision: u32,
    pub updated_by: Identity,
    pub updated_at: Timestamp,
}

/// Native platform operation. The app can read these rows after authorizing a
/// release run, but the job cannot change what passes its own release gate.
#[spacetimedb::reducer]
pub fn register_ai_chat_acceptance_fixture(
    ctx: &ReducerContext,
    organization_id: u64,
    environment: String,
    release_sha: String,
    fixture_json: String,
) -> Result<(), String> {
    require_platform(ctx)?;
    if !ctx
        .db
        .organization()
        .id()
        .find(&organization_id)
        .is_some_and(|row| row.is_active && row.organization_id == organization_id)
    {
        return Err("active organization required for chat acceptance fixtures".into());
    }
    validate_scope(&environment, &release_sha)?;
    let (manifest, companies) = validate_manifest(&fixture_json, &release_sha)?;
    let fixture_json = manifest.to_string();
    let existing = find_fixture(ctx, organization_id, &environment, &release_sha)?;
    if let Some(row) = &existing {
        if row.fixture_json == fixture_json {
            return Ok(());
        }
        if !release_sha.is_empty() {
            return Err("the chat acceptance fixture is already pinned for this release".into());
        }
    }
    let table = ctx.db.ai_chat_acceptance_fixture();
    let fresh_company_id = manifest["fresh"]["companyId"].as_u64();
    if let Some(fresh_company_id) = fresh_company_id {
        let baseline = find_fixture(ctx, organization_id, &environment, "")?
            .ok_or("an approved baseline is required before pinning a release")?;
        let baseline: Value = serde_json::from_str(&baseline.fixture_json)
            .map_err(|_| "invalid approved baseline")?;
        if baseline["upgraded"] != manifest["upgraded"] {
            return Err("the upgraded fixture does not match the approved baseline".into());
        }
        if table
            .ai_chat_acceptance_fixture_by_fresh_company()
            .filter(&fresh_company_id)
            .any(|row| row.release_sha != release_sha)
        {
            return Err("fresh company has already been used for another release".into());
        }
    }
    let default_company = default_company_id_for_organization(ctx, organization_id)?;
    for company_id in companies {
        let company = ctx
            .db
            .company()
            .id()
            .find(&company_id)
            .filter(|row| row.organization_id == organization_id && row.deleted_at.is_none())
            .ok_or("acceptance company must belong to the active organization")?;
        if company_id == default_company
            || company.is_parent
            || !eligible_company_code(&company.code, fresh_company_id == Some(company_id))
        {
            return Err("chat acceptance requires a dedicated test company".into());
        }
    }
    validate_source(ctx, organization_id, &manifest["upgraded"])?;
    if let Some(fresh) = manifest.get("fresh") {
        validate_source(ctx, organization_id, fresh)?;
    }

    let (row, action) = match existing {
        Some(row) => (
            table.id().update(AiChatAcceptanceFixture {
                revision: row
                    .revision
                    .checked_add(1)
                    .ok_or("fixture revision exhausted")?,
                fixture_json,
                updated_by: ctx.sender(),
                updated_at: ctx.timestamp,
                ..row
            }),
            "UPDATE",
        ),
        None => (
            table.insert(AiChatAcceptanceFixture {
                id: 0,
                organization_id,
                environment,
                release_sha,
                fixture_json,
                fresh_company_id: fresh_company_id.unwrap_or(0),
                revision: 1,
                updated_by: ctx.sender(),
                updated_at: ctx.timestamp,
            }),
            "CREATE",
        ),
    };
    write_audit_log_v2(
        ctx,
        organization_id,
        AuditLogParams {
            company_id: None,
            table_name: "ai_chat_acceptance_fixture",
            record_id: row.id,
            action,
            old_values: None,
            new_values: None,
            changed_fields: vec!["fixture_json".into(), "revision".into()],
            metadata: None,
        },
    );
    Ok(())
}

fn find_fixture(
    ctx: &ReducerContext,
    organization_id: u64,
    environment: &str,
    release_sha: &str,
) -> Result<Option<AiChatAcceptanceFixture>, String> {
    let mut matches = ctx
        .db
        .ai_chat_acceptance_fixture()
        .ai_chat_acceptance_fixture_by_release()
        .filter((&organization_id, environment, release_sha));
    let result = matches.next();
    if matches.next().is_some() {
        return Err("ambiguous chat acceptance fixture scope".into());
    }
    Ok(result)
}

fn validate_scope(environment: &str, release_sha: &str) -> Result<(), String> {
    if environment.is_empty()
        || environment.len() > 64
        || !environment.as_bytes()[0].is_ascii_alphanumeric()
        || !environment.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
    {
        return Err("invalid chat acceptance environment".into());
    }
    if !release_sha.is_empty()
        && (release_sha.len() != 40
            || !release_sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')))
    {
        return Err("invalid chat acceptance release SHA".into());
    }
    Ok(())
}

fn eligible_company_code(code: &str, fresh: bool) -> bool {
    code.strip_prefix("AI_CHAT_ACCEPT_")
        .or_else(|| {
            if fresh {
                None
            } else {
                code.strip_prefix("FARM_ACCEPT_")
            }
        })
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        })
}

fn validate_manifest(raw: &str, release_sha: &str) -> Result<(Value, Vec<u64>), String> {
    if raw.len() > MAX_FIXTURE_BYTES {
        return Err("chat acceptance fixture exceeds its size limit".into());
    }
    let manifest: Value = serde_json::from_str(raw).map_err(|_| "invalid chat acceptance JSON")?;
    let root = fields(
        &manifest,
        &[
            "fresh",
            "upgraded",
            "activationProof",
            "journal",
            "maxWithholdRate",
            "namedRecord",
            "followUp",
            "nonEnglish",
            "emptyCompany",
            "summaryHandoff",
            "revoked",
            "importContinuation",
        ],
    )?;
    match root.get("activationProof") {
        None if release_sha.is_empty() => (),
        Some(proof) if !release_sha.is_empty() && is_compact_proof(proof) => (),
        _ => return Err("exact releases require a compact cutover activation proof".into()),
    }
    let upgraded = cohort(&manifest["upgraded"], None)?;
    let mut companies = vec![upgraded];
    let fresh = match root.get("fresh") {
        Some(_) if release_sha.is_empty() => {
            return Err("the baseline cannot contain a fresh company fixture".into());
        }
        Some(value) => {
            let company = cohort(value, Some(release_sha))?;
            if company == upgraded {
                return Err("fresh and upgraded chat acceptance companies must differ".into());
            }
            companies.push(company);
            Some(company)
        }
        None if release_sha.is_empty() => None,
        None => return Err("an exact chat acceptance release requires a fresh fixture".into()),
    };
    if let Some(value) = root.get("maxWithholdRate") {
        if !value
            .as_f64()
            .is_some_and(|rate| (0.0..=1.0).contains(&rate))
        {
            return Err("invalid chat acceptance withhold threshold".into());
        }
    }
    if let Some(journal) = root.get("journal") {
        companies.push(validate_journal(journal)?);
    }
    if let Some(languages) = root.get("nonEnglish") {
        let languages = fields(languages, &["fr", "rw"])?;
        if languages.is_empty() {
            return Err("nonEnglish requires at least one language".into());
        }
        for value in languages.values() {
            companies.push(validate_scenario("namedRecord", value)?);
        }
    }
    for name in [
        "namedRecord",
        "followUp",
        "emptyCompany",
        "summaryHandoff",
        "revoked",
        "importContinuation",
    ] {
        if let Some(value) = root.get(name) {
            let company = validate_scenario(name, value)?;
            if name == "emptyCompany" && (company == upgraded || Some(company) == fresh) {
                return Err("empty company fixture must use a separate company".into());
            }
            companies.push(company);
        }
    }
    companies.sort_unstable();
    companies.dedup();
    Ok((manifest, companies))
}

fn is_compact_proof(value: &Value) -> bool {
    let Some(raw) = value.as_str().filter(|raw| raw.len() <= 2048) else {
        return false;
    };
    let mut parts = raw.split('.');
    let is_segment = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    };
    (0..3).all(|_| parts.next().is_some_and(is_segment)) && parts.next().is_none()
}

fn fields<'a>(value: &'a Value, allowed: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let map = value
        .as_object()
        .ok_or("invalid chat acceptance fixture object")?;
    if map.keys().any(|key| !allowed.contains(&key.as_str())) {
        // Keep rejected input out of reducer errors and logs.
        return Err("unexpected chat acceptance fixture field".into());
    }
    Ok(map)
}

fn fixture_text(value: &Value) -> Result<&str, String> {
    value
        .as_str()
        .filter(|value| !value.trim().is_empty() && value.len() <= MAX_TEXT_BYTES)
        .ok_or_else(|| "invalid chat acceptance text".into())
}

fn numeric_id(value: &Value) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|id| (1..=MAX_SAFE_JSON_ID).contains(id))
        .ok_or_else(|| "invalid chat acceptance numeric ID".into())
}

fn record_id(value: &Value) -> Result<u64, String> {
    if let Some(raw) = value.as_str() {
        if !raw.starts_with('0') && raw.bytes().all(|byte| byte.is_ascii_digit()) {
            if let Ok(id) = raw.parse::<u64>() {
                return Ok(id);
            }
        }
    }
    numeric_id(value)
}

fn cohort(value: &Value, release_sha: Option<&str>) -> Result<u64, String> {
    let mut allowed = vec![
        "companyId",
        "documentId",
        "sourceVersion",
        "question",
        "expectedAnswerText",
    ];
    if release_sha.is_some() {
        allowed.push("provisionedReleaseSha");
    }
    fields(value, &allowed)?;
    if let Some(sha) = release_sha {
        if value["provisionedReleaseSha"] != sha {
            return Err("fresh chat acceptance fixture is not pinned to this release".into());
        }
    }
    numeric_id(&value["documentId"])?;
    fixture_text(&value["sourceVersion"])?;
    fixture_text(&value["question"])?;
    fixture_text(&value["expectedAnswerText"])?;
    numeric_id(&value["companyId"])
}

fn validate_source(ctx: &ReducerContext, org: u64, value: &Value) -> Result<(), String> {
    let company = numeric_id(&value["companyId"])?;
    let document_id = numeric_id(&value["documentId"])?;
    let source_version = fixture_text(&value["sourceVersion"])?;
    let current_id = ctx
        .db
        .document()
        .id()
        .find(&document_id)
        .filter(|row| {
            row.organization_id == org && row.company_id == Some(company) && !row.is_deleted
        })
        .and_then(|row| row.current_version_id)
        .ok_or("acceptance document is not a current company document")?;
    let version = ctx
        .db
        .document_version()
        .id()
        .find(&current_id)
        .filter(|row| {
            row.organization_id == org && row.document_id == document_id && row.is_current
        })
        .ok_or("acceptance document version is not current")?;
    let checksum = version
        .checksum
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("acceptance document version requires a checksum")?;
    let expected_version = format!(
        "v{}-{}",
        version.version_number,
        checksum[..16].to_ascii_lowercase()
    );
    if source_version != expected_version
        || !ctx
            .db
            .ai_evidence_passage()
            .ai_evidence_passage_by_source()
            .filter((
                &org,
                &company,
                &String::from("document"),
                &format!("document:{document_id}"),
            ))
            .any(|row| {
                row.source_version == source_version
                    && row.source_version_id.is_some()
                    && row.status == "current"
                    && row.text_state == TEXT_PRESENT
            })
    {
        return Err("acceptance document version has no current indexed evidence".into());
    }
    Ok(())
}

fn validate_journal(value: &Value) -> Result<u64, String> {
    let map = fields(
        value,
        &[
            "companyId",
            "accountMoveId",
            "question",
            "expectedAmountText",
            "expectedDebitText",
            "foreign",
            "ambiguous",
        ],
    )?;
    let id = record_id(&value["accountMoveId"])?;
    let question = fixture_text(&value["question"])?;
    let amount = fixture_text(&value["expectedAmountText"])?;
    if !amount.bytes().any(|byte| byte.is_ascii_digit()) {
        return Err("chat acceptance journal amount must include a digit".into());
    }
    fixture_text(&value["expectedDebitText"])?;
    if let Some(foreign) = map.get("foreign") {
        fields(foreign, &["accountMoveId", "question", "forbiddenText"])?;
        if record_id(&foreign["accountMoveId"])? == id {
            return Err("foreign journal fixture must use a distinct record".into());
        }
        fixture_text(&foreign["question"])?;
        fixture_text(&foreign["forbiddenText"])?;
    }
    if let Some(ambiguous) = map.get("ambiguous") {
        fields(ambiguous, &["question", "expectedClarificationText"])?;
        if fixture_text(&ambiguous["question"])?.trim() == question.trim() {
            return Err("ambiguous journal fixture must use a distinct question".into());
        }
        fixture_text(&ambiguous["expectedClarificationText"])?;
    }
    numeric_id(&value["companyId"])
}

fn record_ref(value: &Value) -> Result<(), String> {
    let entity = fixture_text(&value["entityType"])?;
    if entity.len() > 80
        || !entity.as_bytes()[0].is_ascii_lowercase()
        || !entity
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err("invalid chat acceptance entity type".into());
    }
    record_id(&value["entityId"])?;
    Ok(())
}

fn validate_scenario(name: &str, value: &Value) -> Result<u64, String> {
    let extras: &[&str] = match name {
        "namedRecord" => &["entityType", "entityId", "expectedText", "uiContext"],
        "followUp" => &["chatSessionKey", "first", "expectedText"],
        "emptyCompany" => &["expectedText"],
        "summaryHandoff" => &["capabilityKey", "uiContext"],
        "revoked" => &["entityType", "entityId", "forbiddenText", "uiContext"],
        "importContinuation" => &["importTaskRefs", "expectedRecords", "expectedText"],
        _ => return Err("unknown chat acceptance scenario".into()),
    };
    let mut allowed = vec!["companyId", "question", "expectedGap"];
    allowed.extend_from_slice(extras);
    let map = fields(value, &allowed)?;
    let company = numeric_id(&value["companyId"])?;
    let question = fixture_text(&value["question"])?;
    if map
        .get("expectedGap")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("invalid chat acceptance expected-gap flag".into());
    }
    if let Some(ui) = map.get("uiContext") {
        for field in fields(ui, &["route", "module", "active_tab"])?.values() {
            fixture_text(field)?;
        }
    }
    match name {
        "namedRecord" => {
            record_ref(value)?;
            fixture_text(&value["expectedText"])?;
        }
        "followUp" => {
            let key = fixture_text(&value["chatSessionKey"])?;
            if key.len() > 100
                || !key
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err("invalid acceptance chat session key".into());
            }
            let first = &value["first"];
            fields(first, &["entityType", "entityId", "question"])?;
            record_ref(first)?;
            if fixture_text(&first["question"])?.trim() == question.trim() {
                return Err("follow-up fixture must use a distinct question".into());
            }
        }
        "summaryHandoff" => {
            let key = fixture_text(&value["capabilityKey"])?;
            if key.len() > 160
                || !key.as_bytes()[0].is_ascii_lowercase()
                || !key.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'_' | b'.' | b'-')
                })
            {
                return Err("invalid chat acceptance capability key".into());
            }
        }
        "revoked" => {
            record_ref(value)?;
            fixture_text(&value["forbiddenText"])?;
            fixture_text(&value["uiContext"]["route"])?;
            fixture_text(&value["uiContext"]["module"])?;
        }
        "emptyCompany" => {
            fixture_text(&value["expectedText"])?;
        }
        "importContinuation" => {
            let tasks = value["importTaskRefs"]
                .as_array()
                .filter(|rows| (1..=4).contains(&rows.len()))
                .ok_or("invalid chat acceptance import task references")?;
            let mut distinct = std::collections::BTreeSet::new();
            for task in tasks {
                let task = fixture_text(task)?;
                if task.len() != 32
                    || !task
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
                    || !distinct.insert(task)
                {
                    return Err("invalid chat acceptance import task ID".into());
                }
            }
            let records = value["expectedRecords"]
                .as_array()
                .filter(|rows| (1..=32).contains(&rows.len()))
                .ok_or("invalid chat acceptance expected import records")?;
            for record in records {
                fields(record, &["entityType", "entityId"])?;
                record_ref(record)?;
            }
        }
        _ => return Err("unknown chat acceptance scenario".into()),
    }
    if let Some(text) = map.get("expectedText") {
        fixture_text(text)?;
    }
    Ok(company)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const RELEASE: &str = "b5b9254a7b962cb8eff38a712072d097a17d3b89";

    fn fixture(company: u64) -> Value {
        json!({
            "companyId":company,
            "documentId":17,
            "sourceVersion":"v1-1234567890abcdef",
            "question":"What is the fixture code?",
            "expectedAnswerText":"CHAT-FIXTURE"
        })
    }

    #[test]
    fn pins_candidate_to_its_release_and_a_separate_company() {
        assert!(validate_scope("production", RELEASE).is_ok());
        assert!(validate_scope("invalid'env", RELEASE).is_err());
        assert!(validate_scope("production", "branch-name").is_err());
        let mut config = json!({ "upgraded": fixture(41) });
        assert!(validate_manifest(&config.to_string(), "").is_ok());
        assert!(validate_manifest(&config.to_string(), RELEASE).is_err());
        config["fresh"] = fixture(42);
        config["fresh"]["provisionedReleaseSha"] = json!(RELEASE);
        assert!(validate_manifest(&config.to_string(), RELEASE).is_err());
        config["activationProof"] = json!("aGVhZGVy.cGF5bG9hZA.c2ln");
        assert!(validate_manifest(&config.to_string(), "").is_err());
        assert_eq!(
            validate_manifest(&config.to_string(), RELEASE).unwrap().1,
            vec![41, 42]
        );
        config["fresh"]["companyId"] = json!(41);
        assert!(validate_manifest(&config.to_string(), RELEASE).is_err());
        config["fresh"]["companyId"] = json!(42);
        config["fresh"]["provisionedReleaseSha"] = json!("wrong");
        assert!(validate_manifest(&config.to_string(), RELEASE).is_err());
    }

    #[test]
    fn accepts_only_bounded_compact_activation_proof_shape() {
        assert!(is_compact_proof(&json!("aGVhZGVy.cGF5bG9hZA.c2ln")));
        for malformed in ["", "a.b.", "a.b", "a.b.c.d", "a.b.c=", "a.b. c"] {
            assert!(!is_compact_proof(&json!(malformed)));
        }
        assert!(!is_compact_proof(&json!(format!(
            "a.b.{}",
            "c".repeat(2048)
        ))));
    }

    #[test]
    fn recognizes_dedicated_test_codes_and_requires_the_new_prefix_for_fresh() {
        assert!(eligible_company_code("AI_CHAT_ACCEPT_B5B9254", true));
        assert!(eligible_company_code("FARM_ACCEPT_20261031", false));
        assert!(!eligible_company_code("FARM_ACCEPT_20261031", true));
        assert!(!eligible_company_code("AI_CHAT_ACCEPT_", true));
        assert!(!eligible_company_code("UMUNUPFU_MUGISHA", false));
    }

    #[test]
    fn rejects_credentials_at_each_known_nesting_boundary() {
        let config = json!({
            "upgraded": fixture(41),
            "followUp": {
                "companyId": 41, "question":"And its code?", "chatSessionKey": "follow-up",
                "first": { "entityType":"contacts", "entityId":"18446744073709551615", "question":"Find the test contact." }
            },
            "nonEnglish": {
                "fr": { "companyId":41, "question":"Quel code ?", "entityType":"contacts",
                    "entityId":31, "expectedText":"CHAT-FIXTURE", "uiContext": { "route": "/crm" } }
            }
        });
        assert!(validate_manifest(&config.to_string(), "").is_ok());
        for pointer in [
            "",
            "/upgraded",
            "/followUp/first",
            "/nonEnglish/fr/uiContext",
        ] {
            let mut invalid = config.clone();
            invalid.pointer_mut(pointer).unwrap()["cookie"] = json!("ineligible");
            assert!(validate_manifest(&invalid.to_string(), "").is_err());
        }
        let mut invalid = config.clone();
        invalid["followUp"]["first"]["entityId"] = json!("18446744073709551616");
        assert!(validate_manifest(&invalid.to_string(), "").is_err());
    }
}
