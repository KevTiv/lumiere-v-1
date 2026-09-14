use lumiere_presentation_core::{ModuleDraft, PreviewContract};
use schemars::generate::SchemaSettings;

fn main() {
    let generator = SchemaSettings::draft07().into_generator();
    let schema = if std::env::args().nth(1).as_deref() == Some("preview") {
        generator.into_root_schema_for::<PreviewContract>()
    } else {
        generator.into_root_schema_for::<ModuleDraft>()
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&schema).expect("schema serialization")
    );
}
