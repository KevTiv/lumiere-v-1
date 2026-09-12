use lumiere_presentation_core::ModuleDraft;
use schemars::generate::SchemaSettings;
use serde_json::Value;

#[test]
fn preview_schema_matches_canonical_rust_schema() {
    let generated = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<lumiere_presentation_core::PreviewContract>();
    let checked_in: Value = serde_json::from_str(include_str!(
        "../../../frontend/packages/presentation-core/schema/preview-contract.schema.json"
    ))
    .expect("preview schema must be JSON");
    assert_eq!(serde_json::to_value(generated).unwrap(), checked_in);
}

#[test]
fn generated_frontend_schema_matches_canonical_rust_schema() {
    let generated = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<ModuleDraft>();
    let generated = serde_json::to_value(generated).expect("Rust schema must serialize");
    let checked_in: Value = serde_json::from_str(include_str!(
        "../../../frontend/packages/presentation-core/schema/module-draft.schema.json"
    ))
    .expect("frontend schema must be JSON");
    assert_eq!(
        generated, checked_in,
        "frontend schema drifted from canonical Rust schema"
    );
}

#[test]
fn saved_draft_schema_matches_canonical_rust_schema() {
    let generated = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<lumiere_presentation_core::SavedDraftContract>();
    let checked_in: Value = serde_json::from_str(include_str!(
        "../../../frontend/packages/presentation-core/schema/saved-draft-contract.schema.json"
    ))
    .expect("saved draft schema must be JSON");
    assert_eq!(serde_json::to_value(generated).unwrap(), checked_in);
}
