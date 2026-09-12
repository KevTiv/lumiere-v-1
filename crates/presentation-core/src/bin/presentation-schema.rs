use lumiere_presentation_core::ModuleDraft;
use schemars::generate::SchemaSettings;

fn main() {
    let schema = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<ModuleDraft>();
    println!(
        "{}",
        serde_json::to_string_pretty(&schema).expect("schema serialization")
    );
}
