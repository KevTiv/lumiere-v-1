use lumiere_contracts::manifests::{
    PRESENTATION_MODULE_DRAFT_SCHEMA, PRESENTATION_PREVIEW_CONTRACT_SCHEMA,
};
use lumiere_presentation_core::ModuleDraft;
use schemars::generate::SchemaSettings;
use serde_json::Value;

/// The released presentation schemas must match the canonical Rust models.
/// A model change fails here until a contracts release ships the new schema.
#[test]
fn preview_schema_matches_released_contract() {
    let generated = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<lumiere_presentation_core::PreviewContract>();
    let released: Value = serde_json::from_str(PRESENTATION_PREVIEW_CONTRACT_SCHEMA)
        .expect("released preview schema must be JSON");
    assert_eq!(
        serde_json::to_value(generated).unwrap(),
        released,
        "preview schema drifted from the released contract"
    );
}

#[test]
fn module_draft_schema_matches_released_contract() {
    let generated = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<ModuleDraft>();
    let released: Value = serde_json::from_str(PRESENTATION_MODULE_DRAFT_SCHEMA)
        .expect("released module draft schema must be JSON");
    assert_eq!(
        serde_json::to_value(generated).unwrap(),
        released,
        "module draft schema drifted from the released contract"
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
