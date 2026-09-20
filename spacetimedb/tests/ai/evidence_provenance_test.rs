//! AIH-13/14/17/18: persisted-fixture tests for the evidence, provenance and
//! knowledge records. Each scenario writes through the real reducers and
//! reads back through the tables, so a pass exercises persisted state and the
//! authorization/scope checks rather than string matching.
use spacetimedb::{Identity, ReducerContext, Table};

use crate::ai::chat::{
    ai_chat_session, create_ai_chat_session, AiChatSession, CreateAiChatSessionParams,
};

use crate::ai::evidence_dependency::{
    ai_evidence_dependency, ai_evidence_source_change, record_ai_evidence_source_change,
    resolve_ai_evidence_dependency, RecordAiEvidenceSourceChangeParams,
    ResolveAiEvidenceDependencyParams,
};
use crate::ai::evidence_lineage::{
    ai_artifact_component, ai_evidence_claim, ai_evidence_decision, bind_ai_artifact_component,
    record_ai_evidence_claim, record_ai_evidence_decision, review_ai_artifact_component_links,
    review_ai_evidence_claim, review_ai_evidence_decision, revise_ai_artifact_component,
    BindAiArtifactComponentParams, RecordAiEvidenceClaimParams, RecordAiEvidenceDecisionParams,
    ReviewAiArtifactComponentLinksParams, ReviewAiEvidenceClaimParams,
    ReviewAiEvidenceDecisionParams, ReviseAiArtifactComponentParams,
};
use crate::ai::evidence_source::{
    ai_evidence_contribution, ai_evidence_passage, ai_evidence_source, ai_evidence_source_version,
    find_source, ingest_document_blob_content, inspect_ai_evidence_source_version,
    record_ai_evidence_contribution, record_ai_evidence_passage, record_ai_evidence_source,
    record_ai_evidence_source_version, InspectAiEvidenceSourceVersionParams,
    RecordAiEvidenceContributionParams, RecordAiEvidencePassageParams,
    RecordAiEvidenceSourceParams, RecordAiEvidenceSourceVersionParams,
};
use crate::ai::knowledge_entry::{
    ai_knowledge_entry, ai_knowledge_entry_version, create_ai_knowledge_entry,
    nominate_ai_knowledge_entry_version, propose_ai_knowledge_entry_version,
    review_ai_knowledge_entry_version, set_ai_knowledge_entry_version_state,
    AiKnowledgeVersionContent, CreateAiKnowledgeEntryParams, ReviewAiKnowledgeEntryVersionParams,
};
use crate::core::audit::audit_log;
use crate::core::organization::{company, create_company, CreateCompanyParams};
use crate::documents::documents::{
    create_document, delete_document, document, CreateDocumentParams,
};
use crate::test_harness::{ensure_test_superuser, OrgFixture};

// ── Fixtures ─────────────────────────────────────────────────────────────────

pub(super) fn hash(c: char) -> String {
    c.to_string().repeat(64)
}

pub(super) fn expect_err<T>(
    result: Result<T, String>,
    needle: &str,
    label: &str,
) -> Result<(), String> {
    match result {
        Err(message) if message.to_lowercase().contains(&needle.to_lowercase()) => Ok(()),
        Err(message) => Err(format!(
            "{label}: expected error containing '{needle}', got '{message}'"
        )),
        Ok(_) => Err(format!(
            "{label}: expected error containing '{needle}', got Ok"
        )),
    }
}

pub(super) fn add_company(
    ctx: &ReducerContext,
    fixture: &OrgFixture,
    code: &str,
) -> Result<u64, String> {
    let currency_id = ctx
        .db
        .company()
        .id()
        .find(&fixture.company_id)
        .map(|c| c.currency_id)
        .ok_or("fixture company missing")?;
    create_company(
        ctx,
        fixture.organization_id,
        CreateCompanyParams {
            name: format!("Sibling {code}"),
            code: format!("{code}-{}", fixture.company_id),
            currency_id,
            fiscal_year_end_month: 12,
            fiscal_year_end_day: 31,
            is_parent: false,
            parent_id: Some(fixture.company_id),
            tax_id: None,
            company_registry: None,
            address_street: None,
            address_city: None,
            address_zip: None,
            address_country_code: None,
            metadata: None,
        },
    )?;
    ctx.db
        .company()
        .company_by_org()
        .filter(&fixture.organization_id)
        .filter(|c| c.code == format!("{code}-{}", fixture.company_id))
        .map(|c| c.id)
        .next()
        .ok_or_else(|| "sibling company not found after create".to_string())
}

pub(super) fn seed_chat_session(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: u64,
    session_key: &str,
) -> Result<(), String> {
    create_ai_chat_session(
        ctx,
        organization_id,
        company_id,
        CreateAiChatSessionParams {
            session_key: session_key.to_string(),
            title: None,
            route: None,
            module: Some("ai-harness".into()),
            active_tab: None,
            archived: false,
            metadata: None,
        },
    )
}

pub(super) struct Evidence {
    pub(super) source_id: u64,
    pub(super) version_id: u64,
    pub(super) passage_id: u64,
}

fn source_params(key: &str, scope: &str) -> RecordAiEvidenceSourceParams {
    RecordAiEvidenceSourceParams {
        source_kind: "book".into(),
        source_key: key.into(),
        title: format!("Title of {key}"),
        author_attribution: "known".into(),
        authors: vec!["Ada Author".into()],
        author_organization: None,
        scope: scope.into(),
        retention_policy: "retain_snapshot".into(),
    }
}

pub(super) fn version_params(label: &str) -> RecordAiEvidenceSourceVersionParams {
    RecordAiEvidenceSourceVersionParams {
        version: label.into(),
        edition: Some("2nd".into()),
        publication_date_micros: Some(1_000_000),
        uri: None,
        retrieved_at_micros: Some(2_000_000),
        content_hash: Some(hash('a')),
        snapshot_ref: Some(format!("files/{label}")),
        origin: "book_paper".into(),
        verification: "inspected".into(),
        supersedes_version_id: None,
    }
}

fn passage_params(
    key: &str,
    version: &str,
    passage_key: &str,
    version_id: Option<u64>,
) -> RecordAiEvidencePassageParams {
    RecordAiEvidencePassageParams {
        source_kind: "book".into(),
        source_key: key.into(),
        source_version: version.into(),
        passage_key: passage_key.into(),
        passage_text: format!("Passage {passage_key} of {key}."),
        effective_from_micros: None,
        effective_to_micros: None,
        applicability: vec![],
        source_version_id: version_id,
        coordinates: vec!["page:12".into()],
        text_origin: "original".into(),
        processor_ref: None,
    }
}

pub(super) fn version_id(ctx: &ReducerContext, source_id: u64, label: &str) -> Result<u64, String> {
    ctx.db
        .ai_evidence_source_version()
        .ai_evidence_source_version_by_source()
        .filter(&source_id)
        .find(|v| v.version == label)
        .map(|v| v.id)
        .ok_or_else(|| format!("version {label} not found"))
}

fn passage_id(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    key: &str,
    version: &str,
    passage_key: &str,
) -> Result<u64, String> {
    ctx.db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((&org, &company, &"book".to_string(), &key.to_string()))
        .find(|p| p.source_version == version && p.passage_key == passage_key)
        .map(|p| p.id)
        .ok_or_else(|| format!("passage {key}/{version}/{passage_key} not found"))
}

/// Source + inspected version + one passage, in `(org, company)`.
pub(super) fn seed_evidence(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    key: &str,
    scope: &str,
) -> Result<Evidence, String> {
    record_ai_evidence_source(ctx, org, company, source_params(key, scope))?;
    let source_id = find_source(ctx, org, company, "book", key)
        .map(|s| s.id)
        .ok_or("source not found after record")?;
    record_ai_evidence_source_version(ctx, org, company, source_id, version_params("1"))?;
    let version_id = version_id(ctx, source_id, "1")?;
    record_ai_evidence_passage(
        ctx,
        org,
        company,
        passage_params(key, "1", "p1", Some(version_id)),
    )?;
    let passage_id = passage_id(ctx, org, company, key, "1", "p1")?;
    Ok(Evidence {
        source_id,
        version_id,
        passage_id,
    })
}

pub(super) fn claim_params(passage_ids: Vec<u64>) -> RecordAiEvidenceClaimParams {
    RecordAiEvidenceClaimParams {
        kind: "sourced_fact".into(),
        statement: "Depreciation is straight line.".into(),
        supporting_passage_ids: passage_ids,
        contradicting_passage_ids: vec![],
        calculation_ref: None,
        assumptions: vec![],
        contribution_id: None,
        verification_method: "deterministic".into(),
        verification_outcome: "supported".into(),
        verification_note: None,
        supersedes_claim_id: None,
    }
}

pub(super) fn latest_claim(ctx: &ReducerContext, org: u64) -> Result<u64, String> {
    ctx.db
        .ai_evidence_claim()
        .ai_evidence_claim_by_org()
        .filter(&org)
        .map(|c| c.id)
        .max()
        .ok_or_else(|| "no claim".to_string())
}

fn latest_decision(ctx: &ReducerContext, org: u64) -> Result<u64, String> {
    ctx.db
        .ai_evidence_decision()
        .ai_evidence_decision_by_org()
        .filter(&org)
        .map(|d| d.id)
        .max()
        .ok_or_else(|| "no decision".to_string())
}

pub(super) fn seed_claim(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    passage_ids: Vec<u64>,
) -> Result<u64, String> {
    record_ai_evidence_claim(ctx, org, company, claim_params(passage_ids))?;
    latest_claim(ctx, org)
}

fn decision_params(adopted: Vec<u64>, supporting: Vec<u64>) -> RecordAiEvidenceDecisionParams {
    RecordAiEvidenceDecisionParams {
        title: "Adopt the source's method".into(),
        adopted_claim_ids: adopted,
        supporting_claim_ids: supporting,
        applicability: vec![],
        alternatives: vec!["declining balance".into()],
        adaptations: vec!["five year life".into()],
        assumptions: vec![],
        rationale: "Matches company policy.".into(),
        contribution_id: None,
        supersedes_decision_id: None,
    }
}

pub(super) fn accept(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    decision_id: u64,
) -> Result<(), String> {
    // Acceptance needs a reviewer independent of the proposer.
    hand_decision_to_another_creator(ctx, decision_id)?;
    review_ai_evidence_decision(
        ctx,
        org,
        company,
        decision_id,
        ReviewAiEvidenceDecisionParams {
            outcome: "accepted".into(),
            note: None,
        },
    )
}

pub(super) fn seed_accepted_decision(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    adopted: Vec<u64>,
    supporting: Vec<u64>,
) -> Result<u64, String> {
    record_ai_evidence_decision(ctx, org, company, decision_params(adopted, supporting))?;
    let id = latest_decision(ctx, org)?;
    accept(ctx, org, company, id)?;
    Ok(id)
}

fn bind_params(
    artifact: &str,
    key: &str,
    hash_char: char,
    decisions: Vec<u64>,
) -> BindAiArtifactComponentParams {
    BindAiArtifactComponentParams {
        artifact_ref: artifact.into(),
        component_key: key.into(),
        component_kind: "formula".into(),
        content_hash: hash(hash_char),
        decision_ids: decisions,
        claim_ids: vec![],
    }
}

fn component_id(
    ctx: &ReducerContext,
    org: u64,
    artifact: &str,
    key: &str,
    version: u32,
) -> Result<u64, String> {
    ctx.db
        .ai_artifact_component()
        .ai_artifact_component_by_artifact()
        .filter((&org, &artifact.to_string()))
        .find(|c| c.component_key == key && c.version == version)
        .map(|c| c.id)
        .ok_or_else(|| format!("component {artifact}/{key} v{version} not found"))
}

pub(super) fn change(kind: &str, replacement: Option<u64>) -> RecordAiEvidenceSourceChangeParams {
    RecordAiEvidenceSourceChangeParams {
        change_kind: kind.into(),
        replacement_version_id: replacement,
        reason: format!("fixture: {kind}"),
    }
}

fn knowledge_content(passages: Vec<u64>, decisions: Vec<u64>) -> AiKnowledgeVersionContent {
    AiKnowledgeVersionContent {
        title: "Straight-line depreciation".into(),
        body: "Spread the depreciable cost evenly over the useful life.".into(),
        applicability: vec![],
        source_passage_ids: passages,
        claim_ids: vec![],
        decision_ids: decisions,
        related_entry_ids: vec![],
        nomination_signal: None,
    }
}

fn create_entry(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    key: &str,
    kind: &str,
    content: AiKnowledgeVersionContent,
) -> Result<u64, String> {
    create_ai_knowledge_entry(
        ctx,
        org,
        company,
        CreateAiKnowledgeEntryParams {
            entry_key: key.into(),
            kind: kind.into(),
            domain_tags: vec!["domain:accounting".into()],
            share_scope: "organization".into(),
            team_ref: None,
            content,
        },
    )?;
    ctx.db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_org()
        .filter(&org)
        .filter(|v| {
            ctx.db
                .ai_knowledge_entry()
                .id()
                .find(&v.entry_id)
                .is_some_and(|e| e.entry_key == key)
        })
        .map(|v| v.id)
        .max()
        .ok_or_else(|| "knowledge version not found".to_string())
}

fn review(
    ctx: &ReducerContext,
    org: u64,
    company: u64,
    version_id: u64,
    kind: &str,
    outcome: &str,
) -> Result<(), String> {
    // A knowledge review must come from someone who neither owns the entry
    // nor proposed the version. The suite runs as one sender, so the owner
    // and proposer are set on the rows directly.
    let version = ctx
        .db
        .ai_knowledge_entry_version()
        .id()
        .find(&version_id)
        .ok_or("knowledge version missing")?;
    let entry = ctx
        .db
        .ai_knowledge_entry()
        .id()
        .find(&version.entry_id)
        .ok_or("knowledge entry missing")?;
    ctx.db
        .ai_knowledge_entry()
        .id()
        .update(crate::ai::knowledge_entry::AiKnowledgeEntry {
            owner_uid: other_identity(),
            ..entry
        });
    ctx.db.ai_knowledge_entry_version().id().update(
        crate::ai::knowledge_entry::AiKnowledgeEntryVersion {
            create_uid: other_identity(),
            ..version
        },
    );
    review_ai_knowledge_entry_version(
        ctx,
        org,
        company,
        version_id,
        ReviewAiKnowledgeEntryVersionParams {
            review_kind: kind.into(),
            outcome: outcome.into(),
            note: None,
        },
    )
}

fn knowledge_state(ctx: &ReducerContext, version_id: u64) -> Result<String, String> {
    ctx.db
        .ai_knowledge_entry_version()
        .id()
        .find(&version_id)
        .map(|v| v.review_state)
        .ok_or_else(|| "knowledge version missing".to_string())
}

fn edges_for_dependent(
    ctx: &ReducerContext,
    org: u64,
    kind: &str,
    id: u64,
) -> Vec<(String, String, u64, String)> {
    ctx.db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((&org, &kind.to_string(), &id))
        .map(|e| (e.upstream_kind, e.requirement, e.upstream_id, e.state))
        .collect()
}

pub(super) fn assert_eq_str(actual: &str, expected: &str, label: &str) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{label}: expected '{expected}', got '{actual}'"))
    }
}

/// A distinct actor for separation-of-duties fixtures. The suite runs as one
/// authenticated sender, so an "other" creator is set on the row directly.
pub(super) fn other_identity() -> Identity {
    Identity::from_byte_array([9; 32])
}

pub(super) fn hand_claim_to_another_creator(
    ctx: &ReducerContext,
    claim_id: u64,
) -> Result<(), String> {
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim missing")?;
    let contribution_id = claim.contribution_id;
    ctx.db
        .ai_evidence_claim()
        .id()
        .update(crate::ai::evidence_lineage::AiEvidenceClaim {
            create_uid: other_identity(),
            ..claim
        });
    reattribute_contribution(ctx, contribution_id)
}

/// A contribution made by this sender would also make them the proposer.
fn reattribute_contribution(
    ctx: &ReducerContext,
    contribution_id: Option<u64>,
) -> Result<(), String> {
    let Some(id) = contribution_id else {
        return Ok(());
    };
    let contribution = ctx
        .db
        .ai_evidence_contribution()
        .id()
        .find(&id)
        .ok_or("contribution missing")?;
    if contribution.contributor_uid == ctx.sender() {
        ctx.db.ai_evidence_contribution().id().update(
            crate::ai::evidence_source::AiEvidenceContribution {
                contributor_uid: other_identity(),
                ..contribution
            },
        );
    }
    Ok(())
}

pub(super) fn hand_decision_to_another_creator(
    ctx: &ReducerContext,
    decision_id: u64,
) -> Result<(), String> {
    let decision = ctx
        .db
        .ai_evidence_decision()
        .id()
        .find(&decision_id)
        .ok_or("decision missing")?;
    let contribution_id = decision.contribution_id;
    ctx.db
        .ai_evidence_decision()
        .id()
        .update(crate::ai::evidence_lineage::AiEvidenceDecision {
            create_uid: other_identity(),
            ..decision
        });
    reattribute_contribution(ctx, contribution_id)
}

// ── AIH-13 ───────────────────────────────────────────────────────────────────

/// AIH-13: book/paper, company publication and ERP/policy sources persist and
/// read back; unknown authors and pages stay unknown; a differing replay of a
/// recorded source or passage is rejected.
pub fn test_sources_round_trip_and_unknowns_stay_unknown(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);

    // Book / paper.
    let book = seed_evidence(ctx, org, company, "book-1", "company")?;
    let stored = ctx
        .db
        .ai_evidence_source()
        .id()
        .find(&book.source_id)
        .ok_or("book source")?;
    assert_eq_str(&stored.authors.join(","), "Ada Author", "book authors")?;
    let stored_passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&book.passage_id)
        .ok_or("book passage")?;
    assert_eq_str(
        &stored_passage.coordinates.join(","),
        "page:12",
        "book coordinates",
    )?;
    let stored_version = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&book.version_id)
        .ok_or("book version")?;
    assert_eq_str(&stored_version.snapshot_state, "retained", "snapshot state")?;
    assert_eq_str(&stored_version.verification, "inspected", "verification")?;
    record_ai_evidence_source_version(ctx, org, company, book.source_id, version_params("1"))?;
    let mut changed_retrieval = version_params("1");
    changed_retrieval.retrieved_at_micros = Some(3_000_000);
    expect_err(
        record_ai_evidence_source_version(ctx, org, company, book.source_id, changed_retrieval),
        "different details",
        "changed retrieval replay",
    )?;
    let mut changed_verification = version_params("1");
    changed_verification.verification = "user_reported".into();
    expect_err(
        record_ai_evidence_source_version(ctx, org, company, book.source_id, changed_verification),
        "different details",
        "changed verification replay",
    )?;

    // Company publication: authored by an organization, not a person.
    let mut publication = source_params("pub-1", "organization");
    publication.source_kind = "publication".into();
    publication.authors = vec![];
    publication.author_organization = Some("Acme Corp".into());
    record_ai_evidence_source(ctx, org, company, publication)?;
    let publication_id = find_source(ctx, org, company, "publication", "pub-1")
        .ok_or("publication")?
        .id;
    let mut pv = version_params("2024");
    pv.origin = "company_publication".into();
    pv.snapshot_ref = None; // hash retained only
    record_ai_evidence_source_version(ctx, org, company, publication_id, pv)?;
    let pv_id = version_id(ctx, publication_id, "2024")?;
    let pv_row = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&pv_id)
        .ok_or("pub version")?;
    assert_eq_str(
        &pv_row.snapshot_state,
        "hash_only",
        "hash-only snapshot state",
    )?;

    // ERP / policy record: revision watermark coordinate, extracted text.
    let mut erp = source_params("policy-7", "company");
    erp.source_kind = "policy".into();
    erp.authors = vec![];
    erp.author_organization = Some("Finance".into());
    record_ai_evidence_source(ctx, org, company, erp)?;
    let erp_id = find_source(ctx, org, company, "policy", "policy-7")
        .ok_or("erp")?
        .id;
    let mut ev = version_params("rev7");
    ev.origin = "erp_policy".into();
    record_ai_evidence_source_version(ctx, org, company, erp_id, ev)?;
    let ev_id = version_id(ctx, erp_id, "rev7")?;
    let mut erp_passage = passage_params("policy-7", "rev7", "fields", Some(ev_id));
    erp_passage.source_kind = "policy".into();
    erp_passage.text_origin = "erp_record".into();
    erp_passage.coordinates = vec!["record:policy:7@rev7".into()];
    record_ai_evidence_passage(ctx, org, company, erp_passage)?;

    // OCR text must name its processor; original text must not.
    let mut ocr = passage_params("book-1", "1", "ocr-1", Some(book.version_id));
    ocr.text_origin = "ocr".into();
    expect_err(
        record_ai_evidence_passage(ctx, org, company, ocr.clone()),
        "processor",
        "ocr without processor",
    )?;
    ocr.processor_ref = Some("tesseract@5.3".into());
    record_ai_evidence_passage(ctx, org, company, ocr)?;

    // Unknown authorship and unknown pages stay unknown.
    let mut unknown = source_params("anon-1", "company");
    unknown.author_attribution = "unknown".into();
    unknown.authors = vec![];
    record_ai_evidence_source(ctx, org, company, unknown)?;
    let anon_id = find_source(ctx, org, company, "book", "anon-1")
        .ok_or("anon")?
        .id;
    let mut av = version_params("1");
    av.snapshot_ref = None;
    record_ai_evidence_source_version(ctx, org, company, anon_id, av)?;
    let av_id = version_id(ctx, anon_id, "1")?;
    let mut no_page = passage_params("anon-1", "1", "p1", Some(av_id));
    no_page.coordinates = vec![];
    record_ai_evidence_passage(ctx, org, company, no_page)?;
    let anon = ctx
        .db
        .ai_evidence_source()
        .id()
        .find(&anon_id)
        .ok_or("anon row")?;
    assert_eq_str(&anon.author_attribution, "unknown", "attribution")?;
    if !anon.authors.is_empty() || anon.author_organization.is_some() {
        return Err("unknown attribution acquired an author".to_string());
    }
    let anon_passage = passage_id(ctx, org, company, "anon-1", "1", "p1")?;
    let anon_passage_row = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&anon_passage)
        .ok_or("anon passage")?;
    if !anon_passage_row.coordinates.is_empty() {
        return Err("unknown page acquired a coordinate".to_string());
    }
    let mut invented = source_params("anon-2", "company");
    invented.author_attribution = "unknown".into();
    expect_err(
        record_ai_evidence_source(ctx, org, company, invented),
        "never invented",
        "invented author",
    )?;

    // Replays: identical is a no-op, different is rejected.
    record_ai_evidence_source(ctx, org, company, source_params("book-1", "company"))?;
    let mut altered = source_params("book-1", "company");
    altered.authors = vec!["Someone Else".into()];
    expect_err(
        record_ai_evidence_source(ctx, org, company, altered),
        "different",
        "altered source replay",
    )?;
    record_ai_evidence_passage(
        ctx,
        org,
        company,
        passage_params("book-1", "1", "p1", Some(book.version_id)),
    )?;
    let mut altered_passage = passage_params("book-1", "1", "p1", Some(book.version_id));
    altered_passage.passage_text = "rewritten".into();
    expect_err(
        record_ai_evidence_passage(ctx, org, company, altered_passage),
        "different content",
        "altered passage replay",
    )?;

    // A passage must name the source version it claims.
    let mut mismatched = passage_params("book-1", "9", "px", Some(book.version_id));
    mismatched.passage_text = "x".into();
    expect_err(
        record_ai_evidence_passage(ctx, org, company, mismatched),
        "does not match",
        "mismatched version",
    )?;

    Ok(())
}

/// AIH-13: a recalled source stays unverified everywhere until it is inspected
/// with a real content hash; a contribution can never claim more than the
/// version supports, and the contributor is the caller, not the author.
pub fn test_recollected_source_stays_unverified(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);

    record_ai_evidence_source(ctx, org, company, source_params("recalled-1", "company"))?;
    let source_id = find_source(ctx, org, company, "book", "recalled-1")
        .ok_or("source")?
        .id;

    let mut recalled = version_params("1");
    recalled.origin = "model_recollection".into();
    recalled.verification = "inspected".into();
    expect_err(
        record_ai_evidence_source_version(ctx, org, company, source_id, recalled.clone()),
        "recollection",
        "recollection cannot arrive inspected",
    )?;
    recalled.verification = "unverified_recollection".into();
    recalled.content_hash = None;
    recalled.snapshot_ref = None;
    record_ai_evidence_source_version(ctx, org, company, source_id, recalled)?;
    let vid = version_id(ctx, source_id, "1")?;

    // No passage can hang off an unverified recollection.
    expect_err(
        record_ai_evidence_passage(
            ctx,
            org,
            company,
            passage_params("recalled-1", "1", "p1", Some(vid)),
        ),
        "unverified recollection",
        "passage on recollection",
    )?;

    let contribution = |state: &str| RecordAiEvidenceContributionParams {
        contributor_kind: "user".into(),
        agent_run_id: None,
        session_ref: "session-1".into(),
        turn_ref: Some("turn-3".into()),
        event_ref: None,
        introduced_kind: "source_version".into(),
        source_version_id: Some(vid),
        inspection_state: state.into(),
        is_secondary_quotation: true,
        note: None,
    };
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, contribution("unverified_recollection")),
        "session not found",
        "nonexistent chat session",
    )?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    seed_chat_session(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        "foreign-session",
    )?;
    let mut foreign_session = contribution("unverified_recollection");
    foreign_session.session_ref = "foreign-session".into();
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, foreign_session),
        "session not found",
        "foreign chat session",
    )?;
    let sibling_company = add_company(ctx, &f, "SESSION")?;
    seed_chat_session(ctx, org, sibling_company, "sibling-session")?;
    let mut sibling_session = contribution("unverified_recollection");
    sibling_session.session_ref = "sibling-session".into();
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, sibling_session),
        "session not found",
        "sibling-company chat session",
    )?;
    ctx.db.ai_chat_session().insert(AiChatSession {
        id: 0,
        organization_id: org,
        company_id: company,
        session_key: "not-owned-session".into(),
        title: None,
        route: None,
        module: Some("ai-harness".into()),
        active_tab: None,
        archived: false,
        create_uid: Identity::from_byte_array([7; 32]),
        create_date: ctx.timestamp,
        write_uid: Identity::from_byte_array([7; 32]),
        write_date: ctx.timestamp,
        metadata: None,
    });
    let mut not_owned = contribution("unverified_recollection");
    not_owned.session_ref = "not-owned-session".into();
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, not_owned),
        "not owned",
        "chat session owned by another identity",
    )?;
    seed_chat_session(ctx, org, company, "session-1")?;
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, contribution("inspected")),
        "cannot be 'inspected'",
        "contribution stronger than version",
    )?;
    record_ai_evidence_contribution(ctx, org, company, contribution("unverified_recollection"))?;
    let stored = ctx
        .db
        .ai_evidence_contribution()
        .ai_evidence_contribution_by_org()
        .filter(&org)
        .next()
        .ok_or("contribution not stored")?;
    if stored.contributor_uid != ctx.sender() {
        return Err("contributor must be the authenticated caller".to_string());
    }
    if !stored.is_secondary_quotation {
        return Err("secondary quotation flag lost".to_string());
    }
    // Legacy callers without an event id retain append semantics.
    record_ai_evidence_contribution(ctx, org, company, contribution("unverified_recollection"))?;
    let legacy_count = ctx
        .db
        .ai_evidence_contribution()
        .ai_evidence_contribution_by_org()
        .filter(&org)
        .filter(|row| row.session_ref == "session-1" && row.event_ref.is_none())
        .count();
    if legacy_count != 2 {
        return Err(format!(
            "event-less contributions unexpectedly deduplicated to {legacy_count} rows"
        ));
    }
    let mut event_contribution = contribution("unverified_recollection");
    event_contribution.event_ref = Some("event-1".into());
    record_ai_evidence_contribution(ctx, org, company, event_contribution.clone())?;
    record_ai_evidence_contribution(ctx, org, company, event_contribution.clone())?;
    let event_count = ctx
        .db
        .ai_evidence_contribution()
        .ai_evidence_contribution_by_org()
        .filter(&org)
        .filter(|row| row.session_ref == "session-1" && row.event_ref.as_deref() == Some("event-1"))
        .count();
    if event_count != 1 {
        return Err(format!(
            "idempotent event replay stored {event_count} contribution rows"
        ));
    }
    event_contribution.note = Some("divergent replay".into());
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, event_contribution),
        "event already recorded with different details",
        "divergent contribution event replay",
    )?;

    // An agent contribution must name a run; a bad run is rejected.
    let mut agent = contribution("unverified_recollection");
    agent.contributor_kind = "agent".into();
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, agent.clone()),
        "name its run",
        "agent without run",
    )?;
    agent.agent_run_id = Some(u64::MAX);
    expect_err(
        record_ai_evidence_contribution(ctx, org, company, agent),
        "not found",
        "agent with missing run",
    )?;

    // Only inspection promotes it, and only with a real hash, once.
    expect_err(
        inspect_ai_evidence_source_version(
            ctx,
            org,
            company,
            vid,
            InspectAiEvidenceSourceVersionParams {
                content_hash: "nope".into(),
                snapshot_ref: None,
            },
        ),
        "hex sha-256",
        "inspect with bad hash",
    )?;
    inspect_ai_evidence_source_version(
        ctx,
        org,
        company,
        vid,
        InspectAiEvidenceSourceVersionParams {
            content_hash: hash('c'),
            snapshot_ref: None,
        },
    )?;
    let inspected = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&vid)
        .ok_or("version")?;
    assert_eq_str(
        &inspected.verification,
        "inspected",
        "verification after inspect",
    )?;
    assert_eq_str(
        &inspected.origin,
        "model_recollection",
        "origin is history, not verification",
    )?;
    assert_eq_str(
        &inspected.snapshot_state,
        "hash_only",
        "snapshot state after inspect",
    )?;
    inspect_ai_evidence_source_version(
        ctx,
        org,
        company,
        vid,
        InspectAiEvidenceSourceVersionParams {
            content_hash: hash('c'),
            snapshot_ref: None,
        },
    )?;
    expect_err(
        inspect_ai_evidence_source_version(
            ctx,
            org,
            company,
            vid,
            InspectAiEvidenceSourceVersionParams {
                content_hash: hash('d'),
                snapshot_ref: None,
            },
        ),
        "different content or snapshot",
        "divergent inspection replay",
    )?;
    record_ai_evidence_passage(
        ctx,
        org,
        company,
        passage_params("recalled-1", "1", "p1", Some(vid)),
    )?;
    Ok(())
}

/// AIH-13: references cannot cross a scope. A company-scoped source is
/// invisible to a sibling company; organization scope reaches siblings; and
/// nothing reaches another organization.
pub fn test_cross_scope_references_are_denied(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let foreign = OrgFixture::seed_minimal(ctx)?;
    let (org, company_a) = (f.organization_id, f.company_id);
    let company_b = add_company(ctx, &f, "XS")?;
    seed_chat_session(ctx, org, company_b, "scope-session")?;

    let private = seed_evidence(ctx, org, company_a, "private-src", "company")?;
    let shared = seed_evidence(ctx, org, company_a, "shared-src", "organization")?;

    expect_err(
        record_ai_evidence_claim(ctx, org, company_b, claim_params(vec![private.passage_id])),
        "outside this scope",
        "sibling company reading company-scoped source",
    )?;
    record_ai_evidence_claim(ctx, org, company_b, claim_params(vec![shared.passage_id]))?;

    // Organization-scoped versions may also be introduced in a sibling
    // company's discussion; company-scoped versions remain denied.
    let contribution = |version_id| RecordAiEvidenceContributionParams {
        contributor_kind: "user".into(),
        agent_run_id: None,
        session_ref: "scope-session".into(),
        turn_ref: Some("turn-1".into()),
        event_ref: Some(format!("scope-{version_id}")),
        introduced_kind: "source_version".into(),
        source_version_id: Some(version_id),
        inspection_state: "inspected".into(),
        is_secondary_quotation: false,
        note: None,
    };
    expect_err(
        record_ai_evidence_contribution(ctx, org, company_b, contribution(private.version_id)),
        "outside this scope",
        "sibling contribution using company-scoped source",
    )?;
    record_ai_evidence_contribution(ctx, org, company_b, contribution(shared.version_id))?;

    // A knowledge entry in the sibling company cannot widen access either.
    expect_err(
        create_entry(
            ctx,
            org,
            company_b,
            "leaky",
            "concept",
            knowledge_content(vec![private.passage_id], vec![]),
        ),
        "outside this scope",
        "derived entry widening access",
    )?;

    // Nothing crosses an organization.
    let foreign_result = record_ai_evidence_claim(
        ctx,
        foreign.organization_id,
        foreign.company_id,
        claim_params(vec![shared.passage_id]),
    );
    if foreign_result.is_ok() {
        return Err("a foreign organization referenced another organization's source".to_string());
    }
    Ok(())
}

// ── AIH-14 ───────────────────────────────────────────────────────────────────

/// AIH-14: source -> concept -> decision -> component reconstructs from
/// persisted rows after an in-place edit and a fork; changed links need
/// review; a bibliography does not bind a component; human review is only
/// produced by the review reducer.
pub fn test_lineage_reconstructs_after_edit_and_fork(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let ev = seed_evidence(ctx, org, company, "lineage-src", "company")?;
    seed_chat_session(ctx, org, company, "session-9")?;

    // Discussion contribution introduces the source (a different identity
    // concept from its author).
    record_ai_evidence_contribution(
        ctx,
        org,
        company,
        RecordAiEvidenceContributionParams {
            contributor_kind: "user".into(),
            agent_run_id: None,
            session_ref: "session-9".into(),
            turn_ref: Some("turn-2".into()),
            event_ref: None,
            introduced_kind: "source_version".into(),
            source_version_id: Some(ev.version_id),
            inspection_state: "inspected".into(),
            is_secondary_quotation: false,
            note: None,
        },
    )?;
    let contribution_id = ctx
        .db
        .ai_evidence_contribution()
        .ai_evidence_contribution_by_org()
        .filter(&org)
        .map(|c| c.id)
        .max()
        .ok_or("contribution")?;

    let mut claim = claim_params(vec![ev.passage_id]);
    claim.contribution_id = Some(contribution_id);
    record_ai_evidence_claim(ctx, org, company, claim)?;
    let claim_id = latest_claim(ctx, org)?;

    // Human review is only produced by the review reducer.
    let mut sneaky = claim_params(vec![ev.passage_id]);
    sneaky.verification_method = "human_reviewed".into();
    expect_err(
        record_ai_evidence_claim(ctx, org, company, sneaky),
        "verification_method",
        "recording human_reviewed",
    )?;
    hand_claim_to_another_creator(ctx, claim_id)?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        claim_id,
        ReviewAiEvidenceClaimParams {
            verification_outcome: "supported".into(),
            verification_note: None,
        },
    )?;
    let reviewed = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim")?;
    assert_eq_str(
        &reviewed.verification_method,
        "human_reviewed",
        "reviewed method",
    )?;

    // An ungrounded claim cannot be recorded as supported.
    let mut ungrounded = claim_params(vec![]);
    ungrounded.kind = "inference".into();
    expect_err(
        record_ai_evidence_claim(ctx, org, company, ungrounded),
        "ungrounded",
        "ungrounded supported",
    )?;

    // Decision: proposed decisions cannot justify a component.
    record_ai_evidence_decision(ctx, org, company, decision_params(vec![claim_id], vec![]))?;
    let decision_id = latest_decision(ctx, org)?;
    expect_err(
        bind_ai_artifact_component(
            ctx,
            org,
            company,
            bind_params("wf:1", "step-a", 'd', vec![decision_id]),
        ),
        "cannot justify a component",
        "binding an unreviewed decision",
    )?;
    accept(ctx, org, company, decision_id)?;

    // A bibliography — claims with no decision — does not bind.
    let mut bibliography = bind_params("wf:1", "step-a", 'd', vec![]);
    bibliography.claim_ids = vec![claim_id];
    expect_err(
        bind_ai_artifact_component(ctx, org, company, bibliography),
        "bibliography",
        "bibliography-only binding",
    )?;

    bind_ai_artifact_component(
        ctx,
        org,
        company,
        bind_params("wf:1", "step-a", 'd', vec![decision_id]),
    )?;
    let v1 = component_id(ctx, org, "wf:1", "step-a", 1)?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&v1)
            .ok_or("v1")?
            .link_state,
        "linked",
        "fresh binding",
    )?;
    expect_err(
        bind_ai_artifact_component(
            ctx,
            org,
            company,
            bind_params("wf:1", "step-a", 'e', vec![decision_id]),
        ),
        "already bound",
        "double binding",
    )?;
    expect_err(
        revise_ai_artifact_component(
            ctx,
            org,
            company,
            v1,
            ReviseAiArtifactComponentParams {
                content_hash: hash('d'),
                fork_artifact_ref: None,
                fork_component_key: None,
                decision_ids: None,
                claim_ids: None,
            },
        ),
        "nothing to revise",
        "no-op revision",
    )?;

    // Edit in place: new version, parent lineage, links flagged.
    revise_ai_artifact_component(
        ctx,
        org,
        company,
        v1,
        ReviseAiArtifactComponentParams {
            content_hash: hash('e'),
            fork_artifact_ref: None,
            fork_component_key: None,
            decision_ids: None,
            claim_ids: None,
        },
    )?;
    let v2 = component_id(ctx, org, "wf:1", "step-a", 2)?;
    let v2_row = ctx.db.ai_artifact_component().id().find(&v2).ok_or("v2")?;
    assert_eq_str(&v2_row.link_state, "changed", "edited component link state")?;
    if v2_row.parent_component_id != Some(v1) {
        return Err("edit lost parent lineage".to_string());
    }
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&v1)
            .ok_or("v1 again")?
            .status,
        "superseded",
        "parent status after edit",
    )?;

    // Fork into another artifact.
    revise_ai_artifact_component(
        ctx,
        org,
        company,
        v2,
        ReviseAiArtifactComponentParams {
            content_hash: hash('f'),
            fork_artifact_ref: Some("wf:2".into()),
            fork_component_key: None,
            decision_ids: None,
            claim_ids: None,
        },
    )?;
    let fork = component_id(ctx, org, "wf:2", "step-a", 1)?;
    let fork_row = ctx
        .db
        .ai_artifact_component()
        .id()
        .find(&fork)
        .ok_or("fork")?;
    if fork_row.forked_from_artifact_ref.as_deref() != Some("wf:1")
        || fork_row.parent_component_id != Some(v2)
    {
        return Err("fork lost its source lineage".to_string());
    }
    assert_eq_str(
        &fork_row.link_state,
        "changed",
        "forked component link state",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&v2)
            .ok_or("v2 again")?
            .status,
        "current",
        "parent stays current after fork",
    )?;

    // Reconstruct source -> concept -> decision -> component from the fork,
    // following persisted rows only.
    let mut cursor = ctx.db.ai_artifact_component().id().find(&fork);
    let mut lineage_depth = 0;
    while let Some(component) = cursor {
        lineage_depth += 1;
        cursor = component
            .parent_component_id
            .and_then(|parent| ctx.db.ai_artifact_component().id().find(&parent));
    }
    if lineage_depth != 3 {
        return Err(format!(
            "expected fork -> v2 -> v1 lineage, walked {lineage_depth}"
        ));
    }
    let bound = ctx
        .db
        .ai_artifact_component()
        .id()
        .find(&fork)
        .ok_or("fork")?;
    let decision = ctx
        .db
        .ai_evidence_decision()
        .id()
        .find(&bound.decision_ids[0])
        .ok_or("decision")?;
    let concept = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&decision.adopted_claim_ids[0])
        .ok_or("claim")?;
    let passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&concept.supporting_passage_ids[0])
        .ok_or("passage")?;
    let version = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&passage.source_version_id.ok_or("passage has no version")?)
        .ok_or("version")?;
    let source = ctx
        .db
        .ai_evidence_source()
        .id()
        .find(&version.source_id)
        .ok_or("source")?;
    assert_eq_str(&source.source_key, "lineage-src", "reconstructed source")?;
    assert_eq_str(
        &source.authors.join(","),
        "Ada Author",
        "reconstructed original author",
    )?;
    let contribution = ctx
        .db
        .ai_evidence_contribution()
        .id()
        .find(
            &concept
                .contribution_id
                .ok_or("claim lost its contribution")?,
        )
        .ok_or("contribution row")?;
    assert_eq_str(
        &contribution.turn_ref.clone().unwrap_or_default(),
        "turn-2",
        "reconstructed introducing turn",
    )?;

    // Changed links are re-confirmed by a reviewer, or left unresolved.
    review_ai_artifact_component_links(
        ctx,
        org,
        company,
        v2,
        ReviewAiArtifactComponentLinksParams {
            outcome: "confirmed".into(),
            note: None,
            expected_content_hash: None,
        },
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&v2)
            .ok_or("v2")?
            .link_state,
        "linked",
        "confirmed links",
    )?;
    review_ai_artifact_component_links(
        ctx,
        org,
        company,
        fork,
        ReviewAiArtifactComponentLinksParams {
            outcome: "unresolved".into(),
            note: Some("code diverged".into()),
            expected_content_hash: None,
        },
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&fork)
            .ok_or("fork")?
            .link_state,
        "unresolved",
        "unresolved links",
    )?;
    // Unresolved is never laundered into 'changed' by a further edit.
    revise_ai_artifact_component(
        ctx,
        org,
        company,
        fork,
        ReviseAiArtifactComponentParams {
            content_hash: hash('a'),
            fork_artifact_ref: None,
            fork_component_key: None,
            decision_ids: None,
            claim_ids: None,
        },
    )?;
    let fork_v2 = component_id(ctx, org, "wf:2", "step-a", 2)?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&fork_v2)
            .ok_or("fork v2")?
            .link_state,
        "unresolved",
        "unresolved survives an edit",
    )?;
    Ok(())
}

// ── AIH-17 ───────────────────────────────────────────────────────────────────

/// AIH-17: one concept and one procedure are approved through review; usage
/// signals cannot approve; a version that loses its evidence needs review
/// again; retrieval in a fresh task resolves the lineage.
pub fn test_knowledge_is_approved_by_review_not_usage(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let ev = seed_evidence(ctx, org, company, "knowledge-src", "company")?;
    let claim_id = seed_claim(ctx, org, company, vec![ev.passage_id])?;
    let decision_id = seed_accepted_decision(ctx, org, company, vec![claim_id], vec![])?;

    // Evidence is mandatory; a procedure must carry its decisions.
    expect_err(
        create_entry(
            ctx,
            org,
            company,
            "empty",
            "concept",
            knowledge_content(vec![], vec![]),
        ),
        "at least one source passage or claim",
        "entry without evidence",
    )?;
    expect_err(
        create_entry(
            ctx,
            org,
            company,
            "no-decisions",
            "procedure",
            knowledge_content(vec![ev.passage_id], vec![]),
        ),
        "decisions",
        "procedure without decisions",
    )?;

    let concept = create_entry(
        ctx,
        org,
        company,
        "sl-concept",
        "concept",
        knowledge_content(vec![ev.passage_id], vec![]),
    )?;
    assert_eq_str(
        &knowledge_state(ctx, concept)?,
        "candidate",
        "new entry starts as candidate",
    )?;

    // Usage signals never approve, and there is no manual route to approval.
    nominate_ai_knowledge_entry_version(ctx, org, company, concept, "repeated_use".into())?;
    assert_eq_str(
        &knowledge_state(ctx, concept)?,
        "candidate",
        "state after usage nomination",
    )?;
    expect_err(
        set_ai_knowledge_entry_version_state(ctx, org, company, concept, "approved".into()),
        "state must be one of",
        "manual approval",
    )?;
    expect_err(
        nominate_ai_knowledge_entry_version(
            ctx,
            org,
            company,
            concept,
            "high_retrieval_score".into(),
        ),
        "signal must be one of",
        "unknown nomination signal",
    )?;

    // A single review is not approval; both required kinds are.
    review(ctx, org, company, concept, "source_fidelity", "accepted")?;
    assert_eq_str(&knowledge_state(ctx, concept)?, "reviewed", "one review")?;
    expect_err(
        review(ctx, org, company, concept, "implementation", "accepted"),
        "only a procedure",
        "implementation review of a concept",
    )?;
    review(
        ctx,
        org,
        company,
        concept,
        "domain_interpretation",
        "accepted",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, concept)?,
        "approved",
        "concept approved",
    )?;

    // Procedure: all three review kinds.
    let procedure = create_entry(
        ctx,
        org,
        company,
        "sl-procedure",
        "procedure",
        knowledge_content(vec![ev.passage_id], vec![decision_id]),
    )?;
    review(ctx, org, company, procedure, "source_fidelity", "accepted")?;
    review(
        ctx,
        org,
        company,
        procedure,
        "domain_interpretation",
        "accepted",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, procedure)?,
        "reviewed",
        "procedure before implementation review",
    )?;
    review(ctx, org, company, procedure, "implementation", "accepted")?;
    assert_eq_str(
        &knowledge_state(ctx, procedure)?,
        "approved",
        "procedure approved",
    )?;

    // Fresh task: retrieve approved entries and resolve their lineage.
    for (key, expect_decisions) in [("sl-concept", 0usize), ("sl-procedure", 1)] {
        let entry = ctx
            .db
            .ai_knowledge_entry()
            .ai_knowledge_entry_by_key()
            .filter((&org, &company, &key.to_string()))
            .next()
            .ok_or("entry")?;
        let version = ctx
            .db
            .ai_knowledge_entry_version()
            .ai_knowledge_entry_version_by_entry()
            .filter(&entry.id)
            .find(|v| v.review_state == "approved")
            .ok_or_else(|| format!("{key} has no approved version"))?;
        if version.decision_ids.len() != expect_decisions {
            return Err(format!("{key} lost its decision lineage"));
        }
        let passage = ctx
            .db
            .ai_evidence_passage()
            .id()
            .find(&version.source_passage_ids[0])
            .ok_or("lineage passage")?;
        let source_version = ctx
            .db
            .ai_evidence_source_version()
            .id()
            .find(&passage.source_version_id.ok_or("no version")?)
            .ok_or("lineage version")?;
        assert_eq_str(
            &source_version.verification,
            "inspected",
            "lineage source verification",
        )?;
    }

    // A second version supersedes the first only once it earns approval.
    propose_ai_knowledge_entry_version(
        ctx,
        org,
        company,
        ctx.db
            .ai_knowledge_entry_version()
            .id()
            .find(&concept)
            .ok_or("concept")?
            .entry_id,
        knowledge_content(vec![ev.passage_id], vec![]),
    )?;
    let concept_v2 = ctx
        .db
        .ai_knowledge_entry_version()
        .ai_knowledge_entry_version_by_org()
        .filter(&org)
        .filter(|v| v.supersedes_version_id == Some(concept))
        .map(|v| v.id)
        .next()
        .ok_or("concept v2")?;
    assert_eq_str(
        &knowledge_state(ctx, concept)?,
        "approved",
        "v1 stays approved until v2 earns it",
    )?;
    review(ctx, org, company, concept_v2, "source_fidelity", "accepted")?;
    review(
        ctx,
        org,
        company,
        concept_v2,
        "domain_interpretation",
        "accepted",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, concept)?,
        "superseded",
        "v1 after v2 approval",
    )?;

    // A correction nominates approved knowledge back to review and voids
    // earlier reviews: one fresh review is 'reviewed', not 'approved'.
    nominate_ai_knowledge_entry_version(ctx, org, company, concept_v2, "correction".into())?;
    assert_eq_str(
        &knowledge_state(ctx, concept_v2)?,
        "needs_review",
        "after correction nomination",
    )?;
    review(ctx, org, company, concept_v2, "source_fidelity", "accepted")?;
    assert_eq_str(
        &knowledge_state(ctx, concept_v2)?,
        "reviewed",
        "old reviews no longer count",
    )?;

    // A rejection disputes.
    review(
        ctx,
        org,
        company,
        concept_v2,
        "domain_interpretation",
        "rejected",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, concept_v2)?,
        "disputed",
        "rejected review",
    )?;
    Ok(())
}

// ── AIH-18 ───────────────────────────────────────────────────────────────────

struct Chain {
    ev: Evidence,
    claim_id: u64,
    decision_id: u64,
    component_id: u64,
    knowledge_id: u64,
}

/// passage -> claim -> decision -> component, plus an approved procedure.
fn seed_chain(ctx: &ReducerContext, org: u64, company: u64, key: &str) -> Result<Chain, String> {
    let ev = seed_evidence(ctx, org, company, key, "company")?;
    let claim_id = seed_claim(ctx, org, company, vec![ev.passage_id])?;
    let decision_id = seed_accepted_decision(ctx, org, company, vec![claim_id], vec![])?;
    let artifact = format!("wf:{key}");
    bind_ai_artifact_component(
        ctx,
        org,
        company,
        bind_params(&artifact, "step", 'b', vec![decision_id]),
    )?;
    let component_id = component_id(ctx, org, &artifact, "step", 1)?;
    let knowledge_id = create_entry(
        ctx,
        org,
        company,
        &format!("proc-{key}"),
        "procedure",
        knowledge_content(vec![ev.passage_id], vec![decision_id]),
    )?;
    for kind in ["source_fidelity", "domain_interpretation", "implementation"] {
        review(ctx, org, company, knowledge_id, kind, "accepted")?;
    }
    assert_eq_str(
        &knowledge_state(ctx, knowledge_id)?,
        "approved",
        "seeded procedure",
    )?;
    Ok(Chain {
        ev,
        claim_id,
        decision_id,
        component_id,
        knowledge_id,
    })
}

/// AIH-18: retracting a source flags every dependent, blocks new reuse and
/// execution, and never restores or replaces the original evidence.
pub fn test_retraction_flags_dependents_and_blocks_reuse(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let chain = seed_chain(ctx, org, company, "retract")?;

    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        chain.ev.version_id,
        change("retracted", None),
    )?;

    // History is preserved: passage withdrawn but its text is still there.
    let passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&chain.ev.passage_id)
        .ok_or("passage")?;
    assert_eq_str(&passage.status, "withdrawn", "passage status")?;
    assert_eq_str(
        &passage.text_state,
        "present",
        "retraction keeps text for authorized history",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_evidence_source_version()
            .id()
            .find(&chain.ev.version_id)
            .ok_or("version")?
            .status,
        "retracted",
        "version status",
    )?;

    // Every dependent is flagged.
    assert_eq_str(
        &ctx.db
            .ai_evidence_claim()
            .id()
            .find(&chain.claim_id)
            .ok_or("claim")?
            .status,
        "needs_review",
        "claim",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_evidence_decision()
            .id()
            .find(&chain.decision_id)
            .ok_or("decision")?
            .status,
        "needs_review",
        "decision",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&chain.component_id)
            .ok_or("component")?
            .link_state,
        "unresolved",
        "component",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, chain.knowledge_id)?,
        "needs_review",
        "knowledge",
    )?;
    for (kind, id) in [
        ("claim", chain.claim_id),
        ("decision", chain.decision_id),
        ("component", chain.component_id),
        ("knowledge_version", chain.knowledge_id),
    ] {
        let edges = edges_for_dependent(ctx, org, kind, id);
        if edges.is_empty() {
            return Err(format!("{kind} {id} has no dependency edges"));
        }
        if edges
            .iter()
            .any(|(_, requirement, _, state)| requirement == "required" && state != "invalid")
        {
            return Err(format!(
                "{kind} {id} has a required edge that is not invalid: {edges:?}"
            ));
        }
    }
    let recorded = ctx
        .db
        .ai_evidence_source_change()
        .ai_evidence_source_change_by_version()
        .filter(&chain.ev.version_id)
        .next()
        .ok_or("source change row")?;
    if recorded.affected_dependency_count < 4 || recorded.affected_passage_count != 1 {
        return Err(format!(
            "source change undercounted its effect: {} passages, {} dependencies",
            recorded.affected_passage_count, recorded.affected_dependency_count
        ));
    }

    // New work cannot lean on the retracted evidence or on flagged work.
    expect_err(
        record_ai_evidence_claim(ctx, org, company, claim_params(vec![chain.ev.passage_id])),
        "cannot support new work",
        "new claim on withdrawn passage",
    )?;
    expect_err(
        record_ai_evidence_decision(
            ctx,
            org,
            company,
            decision_params(vec![chain.claim_id], vec![]),
        ),
        "cannot be adopted",
        "new decision on flagged claim",
    )?;
    expect_err(
        create_entry(
            ctx,
            org,
            company,
            "late",
            "concept",
            knowledge_content(vec![chain.ev.passage_id], vec![]),
        ),
        "cannot support new work",
        "new knowledge on withdrawn passage",
    )?;
    expect_err(
        accept(ctx, org, company, chain.decision_id),
        "claim",
        "re-accepting a decision on a flagged claim",
    )?;
    expect_err(
        review_ai_artifact_component_links(
            ctx,
            org,
            company,
            chain.component_id,
            ReviewAiArtifactComponentLinksParams {
                outcome: "confirmed".into(),
                note: None,
                expected_content_hash: None,
            },
        ),
        "cannot justify a component",
        "confirming component links on a flagged decision",
    )?;
    expect_err(
        review(
            ctx,
            org,
            company,
            chain.knowledge_id,
            "source_fidelity",
            "accepted",
        ),
        "required dependency",
        "approving knowledge on retracted evidence",
    )?;
    hand_claim_to_another_creator(ctx, chain.claim_id)?;
    expect_err(
        review_ai_evidence_claim(
            ctx,
            org,
            company,
            chain.claim_id,
            ReviewAiEvidenceClaimParams {
                verification_outcome: "supported".into(),
                verification_note: None,
            },
        ),
        "withdrawn or revoked",
        "re-blessing a claim on retracted evidence",
    )?;

    // An invalid dependency can never be reaffirmed.
    let invalid_edge = ctx
        .db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((&org, &"claim".to_string(), &chain.claim_id))
        .next()
        .ok_or("claim edge")?;
    expect_err(
        resolve_ai_evidence_dependency(
            ctx,
            org,
            company,
            invalid_edge.id,
            ResolveAiEvidenceDependencyParams {
                resolution: "reaffirmed".into(),
                note: "still fine".into(),
            },
        ),
        "cannot be reaffirmed",
        "reaffirming an invalid edge",
    )?;

    // Status only moves forward, and a later mild change cannot restore it.
    expect_err(
        record_ai_evidence_source_change(
            ctx,
            org,
            company,
            chain.ev.version_id,
            change("superseded", None),
        ),
        "only moves forward",
        "moving a retracted version backwards",
    )?;
    Ok(())
}

/// AIH-18: a correction flags dependents for review without invalidating
/// them, and an honest re-review restores the chain end to end.
pub fn test_correction_requires_review_and_recovers(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let chain = seed_chain(ctx, org, company, "correct")?;

    // A correction must name the corrected version.
    expect_err(
        record_ai_evidence_source_change(
            ctx,
            org,
            company,
            chain.ev.version_id,
            change("corrected", None),
        ),
        "must name",
        "correction without replacement",
    )?;
    let mut v2 = version_params("2");
    v2.snapshot_ref = Some("files/2".into());
    record_ai_evidence_source_version(ctx, org, company, chain.ev.source_id, v2)?;
    let v2_id = version_id(ctx, chain.ev.source_id, "2")?;
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        chain.ev.version_id,
        change("corrected", Some(v2_id)),
    )?;

    assert_eq_str(
        &ctx.db
            .ai_evidence_passage()
            .id()
            .find(&chain.ev.passage_id)
            .ok_or("passage")?
            .status,
        "superseded",
        "passage",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_evidence_claim()
            .id()
            .find(&chain.claim_id)
            .ok_or("claim")?
            .status,
        "needs_review",
        "claim",
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&chain.component_id)
            .ok_or("component")?
            .link_state,
        "changed",
        "component is changed, not unresolved",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, chain.knowledge_id)?,
        "needs_review",
        "knowledge",
    )?;
    // Reuse is denied until someone re-reviews.
    expect_err(
        accept(ctx, org, company, chain.decision_id),
        "claim",
        "accepting before re-review",
    )?;

    // Reviewer reaffirms bottom-up: edges, then claim, decision, component, knowledge.
    let reaffirm = |edge_kind: &str, id: u64| -> Result<(), String> {
        let edges: Vec<_> = ctx
            .db
            .ai_evidence_dependency()
            .ai_evidence_dependency_by_dependent()
            .filter((&org, &edge_kind.to_string(), &id))
            .collect();
        for edge in edges {
            if edge.state != "valid" {
                resolve_ai_evidence_dependency(
                    ctx,
                    org,
                    company,
                    edge.id,
                    ResolveAiEvidenceDependencyParams {
                        resolution: "reaffirmed".into(),
                        note: "checked against the corrected edition".into(),
                    },
                )?;
            }
        }
        Ok(())
    };
    reaffirm("claim", chain.claim_id)?;
    hand_claim_to_another_creator(ctx, chain.claim_id)?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        chain.claim_id,
        ReviewAiEvidenceClaimParams {
            verification_outcome: "supported".into(),
            verification_note: None,
        },
    )?;
    reaffirm("decision", chain.decision_id)?;
    accept(ctx, org, company, chain.decision_id)?;
    reaffirm("component", chain.component_id)?;
    review_ai_artifact_component_links(
        ctx,
        org,
        company,
        chain.component_id,
        ReviewAiArtifactComponentLinksParams {
            outcome: "confirmed".into(),
            note: None,
            expected_content_hash: None,
        },
    )?;
    assert_eq_str(
        &ctx.db
            .ai_artifact_component()
            .id()
            .find(&chain.component_id)
            .ok_or("component")?
            .link_state,
        "linked",
        "component after re-review",
    )?;

    // Knowledge needs a fresh review epoch, not the old approval.
    reaffirm("knowledge_version", chain.knowledge_id)?;
    for kind in ["source_fidelity", "domain_interpretation"] {
        review(ctx, org, company, chain.knowledge_id, kind, "accepted")?;
    }
    assert_eq_str(
        &knowledge_state(ctx, chain.knowledge_id)?,
        "reviewed",
        "old approval must not carry over",
    )?;
    review(
        ctx,
        org,
        company,
        chain.knowledge_id,
        "implementation",
        "accepted",
    )?;
    assert_eq_str(
        &knowledge_state(ctx, chain.knowledge_id)?,
        "approved",
        "knowledge re-approved",
    )?;
    Ok(())
}

/// AIH-18: deletion tombstones content but keeps the hash and an honest
/// state; access revocation keeps content out of service but retained.
pub fn test_deletion_and_revocation_preserve_honest_history(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);

    let revoked = seed_evidence(ctx, org, company, "revoked-src", "company")?;
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        revoked.version_id,
        change("access_revoked", None),
    )?;
    let revoked_passage = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&revoked.passage_id)
        .ok_or("revoked passage")?;
    assert_eq_str(
        &revoked_passage.text_state,
        "restricted",
        "revoked text state",
    )?;
    assert_eq_str(
        &revoked_passage.status,
        "withdrawn",
        "revoked passage status",
    )?;
    if revoked_passage.passage_text.is_empty() {
        return Err("revocation must retain content for authorized history".to_string());
    }
    expect_err(
        record_ai_evidence_claim(ctx, org, company, claim_params(vec![revoked.passage_id])),
        "cannot support new work",
        "claim on revoked passage",
    )?;

    let deleted = seed_evidence(ctx, org, company, "deleted-src", "company")?;
    let original_hash = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&deleted.passage_id)
        .ok_or("passage")?
        .content_hash;
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        deleted.version_id,
        change("deleted", None),
    )?;
    let tombstone = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&deleted.passage_id)
        .ok_or("tombstone")?;
    assert_eq_str(&tombstone.text_state, "tombstoned", "deleted text state")?;
    if !tombstone.passage_text.is_empty() {
        return Err("deleted passage text must be cleared".to_string());
    }
    assert_eq_str(
        &tombstone.content_hash,
        &original_hash,
        "hash survives deletion",
    )?;
    let deleted_version = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&deleted.version_id)
        .ok_or("deleted version")?;
    assert_eq_str(&deleted_version.status, "deleted", "deleted version status")?;
    assert_eq_str(
        &deleted_version.snapshot_state,
        "hash_only",
        "a retained hash is not full replay",
    )?;
    if deleted_version.snapshot_ref.is_some() {
        return Err("deleted version kept its snapshot reference".to_string());
    }
    // A replay of the original passage cannot resurrect deleted text.
    record_ai_evidence_passage(
        ctx,
        org,
        company,
        passage_params("deleted-src", "1", "p1", Some(deleted.version_id)),
    )
    .ok();
    let after_replay = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&deleted.passage_id)
        .ok_or("replayed")?;
    if !after_replay.passage_text.is_empty() {
        return Err("replaying a passage restored deleted text".to_string());
    }
    Ok(())
}

/// Production-shaped ingestion proof: content extracted from a server-owned
/// document blob is persisted as a source/version/passage chain, can support a
/// durable claim, and stops supporting answers as soon as access is revoked.
/// Deletion additionally removes the retained passage text without erasing its
/// integrity hash.
pub fn test_document_blob_passage_claim_lifecycle(ctx: &ReducerContext) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let blob_text = "Returns over 500 EUR require controller approval.";
    let checksum = hash('b');

    create_document(
        ctx,
        org,
        Some(company),
        CreateDocumentParams {
            name: "Returns policy".into(),
            description: None,
            file_name: "returns.txt".into(),
            file_size: blob_text.len() as u64,
            mimetype: "text/plain".into(),
            url: "/api/documents/blobs/object/1/default/returns".into(),
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
    let doc = ctx
        .db
        .document()
        .iter()
        .find(|doc| doc.organization_id == org && doc.name == "Returns policy")
        .ok_or("document missing after registration")?;
    if find_source(
        ctx,
        org,
        company,
        "document",
        &format!("document:{}", doc.id),
    )
    .is_some()
    {
        return Err("create_document promoted caller text into governed evidence".to_string());
    }
    let (version_id, passage_count) = ingest_document_blob_content(
        ctx,
        org,
        company,
        doc.id,
        "Returns policy",
        1,
        "/api/documents/blobs/object/41/default/blob",
        Some(&checksum),
        blob_text,
        "inspected",
    )?;
    if passage_count != 1 {
        return Err(format!(
            "expected one extracted passage, got {passage_count}"
        ));
    }

    let source_key = format!("document:{}", doc.id);
    let source = find_source(ctx, org, company, "document", &source_key)
        .ok_or("document source missing after blob ingestion")?;
    if source.scope != "company" {
        return Err(format!(
            "document source must be company scoped, got {}",
            source.scope
        ));
    }
    let version = ctx
        .db
        .ai_evidence_source_version()
        .id()
        .find(&version_id)
        .ok_or("document source version missing after blob ingestion")?;
    assert_eq_str(&version.verification, "inspected", "blob verification")?;
    assert_eq_str(
        version.content_hash.as_deref().unwrap_or_default(),
        &checksum,
        "blob checksum",
    )?;

    let passage = ctx
        .db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((&org, &company, &"document".to_string(), &source_key))
        .next()
        .ok_or("document passage missing after blob ingestion")?;
    assert_eq_str(&passage.passage_text, blob_text, "server extracted text")?;
    assert_eq_str(&passage.text_origin, "extraction", "passage origin")?;
    assert_eq_str(&passage.text_state, "present", "passage text state")?;
    if passage.source_version_id != Some(version_id) {
        return Err("passage is not bound to the ingested source version".to_string());
    }

    let claim_id = seed_claim(ctx, org, company, vec![passage.id])?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim missing after passage binding")?;
    assert_eq_str(
        &claim.verification_outcome,
        "supported",
        "passage-backed claim outcome",
    )?;
    assert_eq_str(&claim.status, "current", "passage-backed claim status")?;

    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        version_id,
        change("access_revoked", None),
    )?;
    let restricted = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&passage.id)
        .ok_or("restricted passage missing")?;
    assert_eq_str(&restricted.status, "withdrawn", "revoked passage")?;
    assert_eq_str(&restricted.text_state, "restricted", "revoked passage text")?;
    let changed_claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim missing after revocation")?;
    assert_eq_str(&changed_claim.status, "needs_review", "revoked claim")?;
    expect_err(
        record_ai_evidence_claim(ctx, org, company, claim_params(vec![passage.id])),
        "cannot support new work",
        "claim after blob access revocation",
    )?;

    create_document(
        ctx,
        org,
        Some(company),
        CreateDocumentParams {
            name: "Deleted handbook".into(),
            description: None,
            file_name: "deleted.txt".into(),
            file_size: 36,
            mimetype: "text/plain".into(),
            url: "/api/documents/blobs/object/1/default/deleted".into(),
            checksum: hash('c'),
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
    let deleted_doc = ctx
        .db
        .document()
        .iter()
        .find(|doc| doc.organization_id == org && doc.name == "Deleted handbook")
        .ok_or("document for deletion missing")?;
    let deleted_source_key = format!("document:{}", deleted_doc.id);
    let (_deleted_version_id, _) = ingest_document_blob_content(
        ctx,
        org,
        company,
        deleted_doc.id,
        "Deleted handbook",
        1,
        "/api/documents/blobs/object/42/default/blob",
        Some(&hash('c')),
        "This text must not survive deletion.",
        "inspected",
    )?;
    let deleted_passage = ctx
        .db
        .ai_evidence_passage()
        .ai_evidence_passage_by_source()
        .filter((&org, &company, &"document".to_string(), &deleted_source_key))
        .next()
        .ok_or("passage for deleted blob missing")?;
    let deleted_hash = deleted_passage.content_hash.clone();
    delete_document(ctx, org, deleted_doc.id)?;
    let tombstone = ctx
        .db
        .ai_evidence_passage()
        .id()
        .find(&deleted_passage.id)
        .ok_or("deleted passage tombstone missing")?;
    assert_eq_str(&tombstone.text_state, "tombstoned", "deleted passage text")?;
    if !tombstone.passage_text.is_empty() {
        return Err("deleted document passage retained plaintext".to_string());
    }
    assert_eq_str(
        &tombstone.content_hash,
        &deleted_hash,
        "deleted passage hash",
    )?;
    Ok(())
}

/// AIH-18: a discretionary dependency asks for acknowledgement instead of
/// blocking; a required one can never be acknowledged away.
pub fn test_discretionary_dependencies_need_acknowledgement(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let main = seed_evidence(ctx, org, company, "main-src", "company")?;
    let inspiration = seed_evidence(ctx, org, company, "inspiration-src", "company")?;
    let main_claim = seed_claim(ctx, org, company, vec![main.passage_id])?;
    let inspiration_claim = seed_claim(ctx, org, company, vec![inspiration.passage_id])?;
    record_ai_evidence_decision(
        ctx,
        org,
        company,
        decision_params(vec![main_claim], vec![inspiration_claim]),
    )?;
    let decision_id = latest_decision(ctx, org)?;

    // Retract only the discretionary inspiration.
    record_ai_evidence_source_change(
        ctx,
        org,
        company,
        inspiration.version_id,
        change("retracted", None),
    )?;
    let edges = edges_for_dependent(ctx, org, "decision", decision_id);
    let discretionary = edges
        .iter()
        .find(|e| e.1 == "discretionary")
        .ok_or("discretionary edge")?;
    let required = edges
        .iter()
        .find(|e| e.1 == "required")
        .ok_or("required edge")?;
    assert_eq_str(
        &discretionary.3,
        "needs_review",
        "discretionary edge never exceeds needs_review",
    )?;
    assert_eq_str(&required.3, "valid", "unrelated required edge stays valid")?;

    // The decision was flagged; accepting asks for acknowledgement.
    assert_eq_str(
        &ctx.db
            .ai_evidence_decision()
            .id()
            .find(&decision_id)
            .ok_or("decision")?
            .status,
        "needs_review",
        "flagged decision",
    )?;
    expect_err(
        accept(ctx, org, company, decision_id),
        "acknowledged review",
        "accepting without acknowledgement",
    )?;

    let discretionary_edge = ctx
        .db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((&org, &"decision".to_string(), &decision_id))
        .find(|e| e.requirement == "discretionary")
        .ok_or("discretionary edge row")?;
    resolve_ai_evidence_dependency(
        ctx,
        org,
        company,
        discretionary_edge.id,
        ResolveAiEvidenceDependencyParams {
            resolution: "acknowledged".into(),
            note: "inspiration only".into(),
        },
    )?;
    accept(ctx, org, company, decision_id)?;

    // A required edge can never be acknowledged away.
    let required_edge = ctx
        .db
        .ai_evidence_dependency()
        .ai_evidence_dependency_by_dependent()
        .filter((&org, &"claim".to_string(), &inspiration_claim))
        .next()
        .ok_or("required claim edge")?;
    expect_err(
        resolve_ai_evidence_dependency(
            ctx,
            org,
            company,
            required_edge.id,
            ResolveAiEvidenceDependencyParams {
                resolution: "acknowledged".into(),
                note: "meh".into(),
            },
        ),
        "discretionary",
        "acknowledging a required edge",
    )?;
    Ok(())
}

// ── Human review ─────────────────────────────────────────────────────────────

/// A human verdict is the reviewer's own, independent act: it persists who
/// reviewed and when, refuses the creator or proposer, refuses superseded or
/// withdrawn claims, keeps the earlier automated verdict in the audit trail,
/// and can never be written by a recorder.
pub fn test_human_review_is_independent_persisted_and_auditable(
    ctx: &ReducerContext,
) -> Result<(), String> {
    ensure_test_superuser(ctx)?;
    let f = OrgFixture::seed_minimal(ctx)?;
    let (org, company) = (f.organization_id, f.company_id);
    let ev = seed_evidence(ctx, org, company, "review-src", "company")?;
    let review = |outcome: &str, note: Option<&str>| ReviewAiEvidenceClaimParams {
        verification_outcome: outcome.into(),
        verification_note: note.map(str::to_string),
    };

    // The recorder path cannot write human_reviewed, whatever else it claims.
    let mut forged = claim_params(vec![ev.passage_id]);
    forged.verification_method = "human_reviewed".into();
    expect_err(
        record_ai_evidence_claim(ctx, org, company, forged),
        "verification_method",
        "recorder writing human_reviewed",
    )?;
    let mut model = claim_params(vec![ev.passage_id]);
    model.verification_method = "model_assisted".into();
    model.verification_note = Some("model rationale".into());
    record_ai_evidence_claim(ctx, org, company, model)?;
    let claim_id = latest_claim(ctx, org)?;
    let stored = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim")?;
    assert_eq_str(
        &stored.verification_method,
        "model_assisted",
        "recorded method",
    )?;
    if stored.reviewer_uid.is_some() || stored.reviewed_at.is_some() {
        return Err("an automated claim carries reviewer identity".into());
    }

    // The creator cannot review their own claim.
    expect_err(
        review_ai_evidence_claim(ctx, org, company, claim_id, review("supported", None)),
        "creator of a claim",
        "self-review of a claim",
    )?;

    // Nor can the user whose contribution introduced it.
    seed_chat_session(ctx, org, company, "review-session")?;
    record_ai_evidence_contribution(
        ctx,
        org,
        company,
        RecordAiEvidenceContributionParams {
            contributor_kind: "user".into(),
            agent_run_id: None,
            session_ref: "review-session".into(),
            turn_ref: None,
            event_ref: Some("review-event".into()),
            introduced_kind: "concept".into(),
            source_version_id: None,
            inspection_state: "user_reported".into(),
            is_secondary_quotation: false,
            note: None,
        },
    )?;
    let contribution_id = ctx
        .db
        .ai_evidence_contribution()
        .iter()
        .filter(|c| c.organization_id == org)
        .map(|c| c.id)
        .max()
        .ok_or("contribution")?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim")?;
    ctx.db
        .ai_evidence_claim()
        .id()
        .update(crate::ai::evidence_lineage::AiEvidenceClaim {
            create_uid: other_identity(),
            contribution_id: Some(contribution_id),
            ..claim
        });
    expect_err(
        review_ai_evidence_claim(ctx, org, company, claim_id, review("supported", None)),
        "proposer of a claim",
        "review by the contribution's proposer",
    )?;

    // Independent of both: a qualified verdict must say how it is qualified.
    hand_claim_to_another_creator(ctx, claim_id)?;
    let claim = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim")?;
    ctx.db
        .ai_evidence_claim()
        .id()
        .update(crate::ai::evidence_lineage::AiEvidenceClaim {
            contribution_id: None,
            ..claim
        });
    expect_err(
        review_ai_evidence_claim(ctx, org, company, claim_id, review("qualified", None)),
        "qualification",
        "qualified without a stated qualification",
    )?;
    review_ai_evidence_claim(
        ctx,
        org,
        company,
        claim_id,
        review("supported", Some("checked against the passage")),
    )?;
    let reviewed = ctx
        .db
        .ai_evidence_claim()
        .id()
        .find(&claim_id)
        .ok_or("claim")?;
    assert_eq_str(
        &reviewed.verification_method,
        "human_reviewed",
        "reviewed method",
    )?;
    assert_eq_str(
        &reviewed.verification_outcome,
        "supported",
        "reviewed outcome",
    )?;
    if reviewed.reviewer_uid != Some(ctx.sender()) || reviewed.reviewed_at != Some(ctx.timestamp) {
        return Err("the reviewer and review time were not persisted on the claim".into());
    }
    // The model verdict it replaced is preserved in audit history, not erased.
    let audited = ctx
        .db
        .audit_log()
        .iter()
        .filter(|a| a.table_name == "ai_evidence_claim" && a.record_id == claim_id)
        .filter_map(|a| a.old_values)
        .any(|old| old.contains("model_assisted") && old.contains("model rationale"));
    if !audited {
        return Err("the prior automated verdict is missing from the audit trail".into());
    }

    // A decision cannot be accepted by its creator or proposer either.
    record_ai_evidence_decision(ctx, org, company, decision_params(vec![claim_id], vec![]))?;
    let decision_id = latest_decision(ctx, org)?;
    expect_err(
        review_ai_evidence_decision(
            ctx,
            org,
            company,
            decision_id,
            ReviewAiEvidenceDecisionParams {
                outcome: "accepted".into(),
                note: None,
            },
        ),
        "creator of a decision",
        "self-acceptance of a decision",
    )?;
    accept(ctx, org, company, decision_id)?;

    // A superseded revision cannot be reviewed; only its replacement can.
    let mut revision = claim_params(vec![ev.passage_id]);
    revision.supersedes_claim_id = Some(claim_id);
    revision.statement = "Depreciation is straight line over five years.".into();
    record_ai_evidence_claim(ctx, org, company, revision)?;
    let revised_id = latest_claim(ctx, org)?;
    hand_claim_to_another_creator(ctx, claim_id)?;
    expect_err(
        review_ai_evidence_claim(ctx, org, company, claim_id, review("supported", None)),
        "superseded",
        "reviewing a superseded claim",
    )?;

    // Review never crosses a tenant boundary: another organization's or a
    // sibling company's claim is not this reviewer's to bless.
    let foreign = OrgFixture::seed_minimal(ctx)?;
    expect_err(
        review_ai_evidence_claim(
            ctx,
            foreign.organization_id,
            foreign.company_id,
            revised_id,
            review("supported", None),
        ),
        "does not belong",
        "cross-organization review",
    )?;
    let sibling = add_company(ctx, &f, "REVIEW")?;
    expect_err(
        review_ai_evidence_claim(ctx, org, sibling, revised_id, review("supported", None)),
        "does not belong",
        "cross-company review",
    )?;

    // Withdrawn evidence makes the claim unreviewable, whatever the verdict.
    hand_claim_to_another_creator(ctx, revised_id)?;
    record_ai_evidence_source_change(ctx, org, company, ev.version_id, change("retracted", None))?;
    for outcome in ["supported", "unsupported"] {
        expect_err(
            review_ai_evidence_claim(ctx, org, company, revised_id, review(outcome, Some("n"))),
            "withdrawn or revoked",
            "reviewing a claim on retracted evidence",
        )?;
    }
    Ok(())
}
