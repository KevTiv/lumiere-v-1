//! Reducer boundary proof using real company and indexed document rows.

use serde_json::{json, Value};
use spacetimedb::{ReducerContext, Table};

use crate::ai::chat_acceptance::{ai_chat_acceptance_fixture, register_ai_chat_acceptance_fixture};
use crate::ai::evidence_source::ingest_document_blob_content;
use crate::core::organization::{company, Company};
use crate::documents::documents::{create_document, document, CreateDocumentParams};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

use super::evidence_provenance_test::expect_err;

const RELEASE: &str = "b5b9254a7b962cb8eff38a712072d097a17d3b89";
const LATER_RELEASE: &str = "b5b9254a7b962cb8eff38a712072d097a17d3b90";

fn seed_case(ctx: &ReducerContext, fixture: &OrgFixture, code: &str) -> Result<Value, String> {
    let company = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .ok_or("fixture company missing")?;
    let company = ctx.db.company().insert(Company {
        id: 0,
        external_id: format!("{}_{}", company.external_id, code),
        code: code.into(),
        name: code.into(),
        is_parent: false,
        parent_id: Some(company.id),
        ..company
    });
    let org = fixture.organization_id;
    let text = "The acceptance code is CHAT-FIXTURE.";
    let checksum = "a".repeat(64);
    let url = "/api/documents/blobs/object/1/default/chat-fixture";
    create_document(
        ctx,
        org,
        Some(company.id),
        CreateDocumentParams {
            name: format!("Acceptance text for {code}"),
            description: None,
            file_name: "chat-fixture.txt".into(),
            file_size: text.len() as u64,
            mimetype: "text/plain".into(),
            url: url.into(),
            checksum: checksum.clone(),
            folder_id: None,
            res_model: None,
            res_id: None,
            partner_id: None,
            tag_ids: vec![],
            is_favorite: false,
            classification_id: None,
            retention_days: None,
            fiscal_kind: None,
            residency_region: None,
            metadata: None,
        },
    )?;
    let document = ctx
        .db
        .document()
        .document_by_org()
        .filter(&org)
        .find(|doc| doc.company_id == Some(company.id))
        .ok_or("acceptance document missing")?;
    ingest_document_blob_content(
        ctx,
        org,
        company.id,
        document.id,
        &document.name,
        1,
        url,
        Some(&checksum),
        text,
        "inspected",
    )?;
    Ok(json!({
        "companyId": company.id,
        "documentId": document.id,
        "sourceVersion": format!("v1-{}", &checksum[..16]),
        "question": "What is the acceptance code?",
        "expectedAnswerText": "CHAT-FIXTURE"
    }))
}

pub fn test_fixture_versions_and_company_scope(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let fixture = OrgFixture::seed_minimal(ctx)?;
    let org = fixture.organization_id;
    let upgraded = seed_case(ctx, &fixture, "FARM_ACCEPT_UPGRADED")?;
    let mut baseline = json!({ "upgraded": upgraded });
    let register = |sha: &str, config: &Value| {
        register_ai_chat_acceptance_fixture(
            ctx,
            org,
            "production".into(),
            sha.into(),
            config.to_string(),
        )
    };
    register("", &baseline)?;
    register("", &baseline)?;
    baseline["maxWithholdRate"] = json!(0.2);
    register("", &baseline)?;
    let revisions = ctx
        .db
        .ai_chat_acceptance_fixture()
        .ai_chat_acceptance_fixture_by_release()
        .filter((&org, &"production".to_string(), &String::new()))
        .map(|row| row.revision)
        .collect::<Vec<_>>();
    if revisions != vec![2] {
        return Err("baseline retries must preserve one row and increment only for changes".into());
    }
    let mut exact = baseline.clone();
    exact["activationProof"] = json!("aGVhZGVy.cGF5bG9hZA.c2ln");
    exact["fresh"] = seed_case(ctx, &fixture, "AI_CHAT_ACCEPT_FRESH")?;
    exact["fresh"]["provisionedReleaseSha"] = json!(RELEASE);
    let mut invalid = exact.clone();
    invalid["fresh"]["documentId"] = exact["upgraded"]["documentId"].clone();
    expect_err(
        register(RELEASE, &invalid),
        "current company document",
        "cross-company reference",
    )?;
    invalid = exact.clone();
    invalid["fresh"]["companyId"] = json!(fixture.company_id);
    expect_err(
        register(RELEASE, &invalid),
        "dedicated test company",
        "default company",
    )?;
    invalid = exact.clone();
    invalid["upgraded"]["question"] = json!("Please return the upgraded code.");
    expect_err(
        register(RELEASE, &invalid),
        "approved baseline",
        "upgraded fixture drift",
    )?;
    register(RELEASE, &exact)?;
    invalid = exact.clone();
    invalid["fresh"]["provisionedReleaseSha"] = json!(LATER_RELEASE);
    expect_err(
        register(LATER_RELEASE, &invalid),
        "already been used",
        "fresh company reuse",
    )?;
    baseline["upgraded"]["question"] = json!("Please return the upgraded code.");
    register("", &baseline)?;
    register(RELEASE, &exact)?;
    exact["fresh"]["question"] = json!("Please return the fresh code.");
    expect_err(
        register(RELEASE, &exact),
        "already pinned",
        "exact fixture mutation",
    )
}
