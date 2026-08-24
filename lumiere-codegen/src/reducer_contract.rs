//! Reducer contract IR derived from the published module schema.

use crate::paths::Paths;
use crate::support::{read_to_string, write_file};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

#[derive(Debug, Deserialize)]
struct ExposureFile {
    version: u32,
    reducers: Vec<ExposureEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct ExposureEntry {
    name: String,
    exposure: Exposure,
    reason: String,
    #[serde(default)]
    unscoped_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CompanyScopeMetadataFile {
    version: u32,
    reducers: Vec<CompanyScopeReducer>,
}

#[derive(Debug, Deserialize)]
struct CompanyScopeReducer {
    name: String,
    #[serde(default)]
    company_paths: Vec<CompanyPathAnnotation>,
    #[serde(default)]
    asserts_no_company_parameter: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
struct CompanyPathAnnotation {
    path: Vec<String>,
    required: bool,
    nullable: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Exposure {
    Denied,
    Session,
}

#[derive(Debug, Serialize)]
struct ReducerManifest {
    version: u32,
    reducers: Vec<ReducerEntry>,
}

#[derive(Debug, Serialize)]
struct ReducerEntry {
    name: String,
    params: Vec<ReducerParam>,
    client_input: ClientInput,
    server_context: ServerContext,
    wire_arguments: Vec<WireArgument>,
    lifecycle: String,
    scope: ReducerScope,
    exposure: Exposure,
    exposure_reason: Option<String>,
    unscoped_reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct ReducerParam {
    name: String,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    ref_target: Option<String>,
}

#[derive(Debug, Default, Serialize)]
struct ReducerScope {
    #[serde(skip_serializing_if = "Option::is_none")]
    organization: Option<ScopeParam>,
    #[serde(skip_serializing_if = "Option::is_none")]
    company: Option<ScopeParam>,
}

#[derive(Debug, Serialize)]
struct ScopeParam {
    parameter: &'static str,
    position: usize,
}

/// Names the reducer parameters that a client may provide to an object-shaped
/// command endpoint.  The parameter position is the canonical reference back
/// to `params`; this metadata deliberately does not repeat a type definition.
#[derive(Debug, Serialize)]
struct ClientInput {
    fields: Vec<ClientInputField>,
}

#[derive(Debug, Serialize)]
struct ClientInputField {
    parameter_position: usize,
}

/// Describes values resolved at the API boundary and validations applied to
/// client-selected scope values.  Organization scope is trusted session
/// context; company scope remains client-selected, but is checked against it.
#[derive(Debug, Serialize)]
struct ServerContext {
    fields: Vec<ServerContextField>,
    validations: Vec<ContextValidation>,
}

#[derive(Debug, Serialize)]
struct ServerContextField {
    parameter_position: usize,
    name: &'static str,
    source: &'static str,
}

#[derive(Debug, Serialize)]
struct ContextValidation {
    parameter_position: usize,
    path: Vec<String>,
    required: bool,
    nullable: bool,
    rule: &'static str,
}

/// Maps the object-shaped input back to the positional SpacetimeDB wire call.
/// `parameter_position` references `params`, avoiding another copy of the
/// parameter's name or type in every target emitter.
#[derive(Debug, Serialize)]
struct WireArgument {
    position: usize,
    parameter_position: usize,
    source: WireArgumentSource,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireArgumentSource {
    ServerContext { field: &'static str },
    ClientInput,
}

pub fn run(paths: &Paths) -> Result<()> {
    let schema_text = read_to_string(&paths.module_schema_json)?;
    let schema: Value = serde_json::from_str(&schema_text)
        .with_context(|| format!("parse module schema {}", paths.module_schema_json.display()))?;
    let exposure_text = read_to_string(&paths.reducer_exposure_json)?;
    let exposure_file: ExposureFile = serde_json::from_str(&exposure_text).with_context(|| {
        format!(
            "parse reducer exposure {}",
            paths.reducer_exposure_json.display()
        )
    })?;
    if exposure_file.version != 1 {
        bail!(
            "unsupported reducer exposure version {}",
            exposure_file.version
        );
    }
    let company_scope_text = read_to_string(&paths.company_scope_metadata_json)?;
    let company_scope_file: CompanyScopeMetadataFile = serde_json::from_str(&company_scope_text)
        .with_context(|| {
            format!(
                "parse company scope metadata {}",
                paths.company_scope_metadata_json.display()
            )
        })?;
    if company_scope_file.version != 1 {
        bail!(
            "unsupported company scope metadata version {}",
            company_scope_file.version
        );
    }
    let mut company_scope_by_name = BTreeMap::new();
    for annotation in company_scope_file.reducers {
        let name = annotation.name.clone();
        if company_scope_by_name
            .insert(name.clone(), annotation)
            .is_some()
        {
            bail!("duplicate company scope metadata entry: {name}");
        }
    }

    let mut exposure_by_name = BTreeMap::new();
    for entry in exposure_file.reducers {
        if entry.reason.trim().is_empty() {
            bail!("exposure entry {} has no reason", entry.name);
        }
        let name = entry.name.clone();
        if exposure_by_name.insert(name.clone(), entry).is_some() {
            bail!("duplicate reducer exposure entry: {name}");
        }
    }

    let reducers = schema
        .get("reducers")
        .and_then(Value::as_array)
        .context("module schema reducers must be an array")?;
    let type_names = schema_type_names(&schema)?;
    let schema_names: BTreeSet<&str> = reducers
        .iter()
        .filter_map(|reducer| reducer.get("name").and_then(Value::as_str))
        .collect();
    validate_exposure_names(&exposure_by_name, &schema_names)?;
    for name in company_scope_by_name.keys() {
        if !schema_names.contains(name.as_str()) {
            bail!("company scope metadata names reducer absent from module schema: {name}");
        }
    }

    let mut entries = Vec::with_capacity(reducers.len());
    for reducer in reducers {
        entries.push(parse_reducer(
            reducer,
            &type_names,
            exposure_by_name.get(
                reducer
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
            company_scope_by_name.get(
                reducer
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
        )?);
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));

    let manifest = ReducerManifest {
        version: 1,
        reducers: entries,
    };
    validate_binding_args(&manifest, &paths.stdb_bindings_dir)?;
    let json = serde_json::to_string_pretty(&manifest)? + "\n";
    write_file(&paths.reducer_manifest_out, &json)?;
    write_file(
        &paths.reducer_contract_rust_out,
        &emit_rust_contract(&manifest),
    )?;
    write_file(
        &paths.stdb_bff_reducers_ts_out,
        &emit_typescript_exposure(&manifest),
    )?;
    Ok(())
}

fn validate_exposure_names(
    exposure_by_name: &BTreeMap<String, ExposureEntry>,
    schema_names: &BTreeSet<&str>,
) -> Result<()> {
    for name in exposure_by_name.keys() {
        if !schema_names.contains(name.as_str()) {
            bail!("reducer exposure names reducer absent from module schema: {name}");
        }
    }
    Ok(())
}

fn schema_type_names(schema: &Value) -> Result<BTreeMap<u64, String>> {
    let mut names = BTreeMap::new();
    for ty in schema
        .get("types")
        .and_then(Value::as_array)
        .context("module schema types must be an array")?
    {
        let Some(index) = ty.get("ty").and_then(Value::as_u64) else {
            continue;
        };
        let Some(name) = ty
            .pointer("/name/name")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        if let Some(previous) = names.insert(index, name.clone()) {
            bail!("typespace ref {index} has two names: {previous} and {name}");
        }
    }
    Ok(names)
}

fn parse_reducer(
    reducer: &Value,
    type_names: &BTreeMap<u64, String>,
    exposure: Option<&ExposureEntry>,
    company_scope: Option<&CompanyScopeReducer>,
) -> Result<ReducerEntry> {
    let name = reducer
        .get("name")
        .and_then(Value::as_str)
        .context("reducer has no name")?
        .to_owned();
    let elements = reducer
        .pointer("/params/elements")
        .and_then(Value::as_array)
        .with_context(|| format!("reducer {name} params.elements must be an array"))?;
    let mut params = Vec::with_capacity(elements.len());
    let mut scope = ReducerScope::default();
    for (position, element) in elements.iter().enumerate() {
        let schema_param_name = element
            .pointer("/name/some")
            .and_then(Value::as_str)
            .with_context(|| format!("reducer {name} parameter {position} has no name"))?;
        // SpacetimeDB's Rust generator removes a leading underscore from
        // intentionally-unused module parameters when it emits `*Args`.
        let param_name = schema_param_name.trim_start_matches('_');
        if param_name.is_empty() {
            bail!("reducer {name} parameter {position} normalizes to an empty name");
        }
        let algebraic_type = element
            .get("algebraic_type")
            .with_context(|| format!("reducer {name} parameter {param_name} has no type"))?;
        let (kind, ref_target) = resolve_type(algebraic_type, type_names)?;
        if param_name == "organization_id" {
            if scope.organization.is_some() {
                bail!("reducer {name} has two organization_id parameters");
            }
            if !is_integer_kind(&kind) && !is_optional_integer_kind(&kind) {
                bail!("reducer {name} organization_id must be an integer, got {kind}");
            }
            scope.organization = Some(ScopeParam {
                parameter: "organization_id",
                position,
            });
        } else if param_name == "company_id" {
            if scope.company.is_some() {
                bail!("reducer {name} has two company_id parameters");
            }
            if !is_integer_kind(&kind) && !is_optional_integer_kind(&kind) {
                bail!("reducer {name} company_id must be an integer, got {kind}");
            }
            scope.company = Some(ScopeParam {
                parameter: "company_id",
                position,
            });
        }
        params.push(ReducerParam {
            name: param_name.to_owned(),
            kind,
            ref_target,
        });
    }

    let lifecycle = lifecycle_name(reducer.get("lifecycle"));
    let (exposure_value, exposure_reason, unscoped_reason) = match exposure {
        Some(entry) => {
            if entry.exposure == Exposure::Session
                && scope.organization.is_none()
                && scope.company.is_none()
                && entry
                    .unscoped_reason
                    .as_deref()
                    .is_none_or(|reason| reason.trim().is_empty())
            {
                bail!("session-exposed reducer {name} is unscoped but has no unscoped_reason");
            }
            (
                entry.exposure,
                Some(entry.reason.clone()),
                entry.unscoped_reason.clone(),
            )
        }
        None => (Exposure::Denied, None, None),
    };

    let (client_input, server_context, wire_arguments) =
        build_input_metadata(&name, &params, &scope, company_scope)?;

    Ok(ReducerEntry {
        name,
        params,
        client_input,
        server_context,
        wire_arguments,
        lifecycle,
        scope,
        exposure: exposure_value,
        exposure_reason,
        unscoped_reason,
    })
}

fn build_input_metadata(
    reducer_name: &str,
    params: &[ReducerParam],
    scope: &ReducerScope,
    company_scope: Option<&CompanyScopeReducer>,
) -> Result<(ClientInput, ServerContext, Vec<WireArgument>)> {
    let organization_position = scope.organization.as_ref().map(|scope| scope.position);
    let company_position = scope.company.as_ref().map(|scope| scope.position);

    let mut client_fields = Vec::with_capacity(params.len());
    let mut context_fields = Vec::new();
    let mut validations = Vec::new();
    let mut wire_arguments = Vec::with_capacity(params.len());

    if let Some(position) = organization_position {
        context_fields.push(ServerContextField {
            parameter_position: position,
            name: "organization_id",
            source: "authenticated_session.organization_id",
        });
    }
    if let Some(position) = company_position {
        validations.push(ContextValidation {
            parameter_position: position,
            path: Vec::new(),
            required: true,
            nullable: params
                .get(position)
                .is_some_and(|param| is_optional_integer_kind(&param.kind)),
            rule: "belongs_to_organization_if_present",
        });
    }
    if let Some(metadata) = company_scope {
        if metadata.asserts_no_company_parameter
            && (company_position.is_some() || !metadata.company_paths.is_empty())
        {
            bail!("reducer {reducer_name} both asserts and declares company scope");
        }
        for annotation in &metadata.company_paths {
            let (root, nested_path) = annotation
                .path
                .split_first()
                .with_context(|| format!("reducer {reducer_name} has an empty company path"))?;
            let position = params
                .iter()
                .position(|param| &param.name == root)
                .with_context(|| {
                    format!(
                        "reducer {reducer_name} company path root {root} is not a reducer parameter"
                    )
                })?;
            if nested_path.is_empty() && root != "company_id" {
                bail!("reducer {reducer_name} direct company path must target company_id");
            }
            if !nested_path.is_empty()
                && nested_path.last().map(String::as_str) != Some("company_id")
            {
                bail!("reducer {reducer_name} nested company path must end in company_id");
            }
            if !nested_path.is_empty() && params[position].ref_target.is_none() {
                bail!("reducer {reducer_name} nested company path root {root} is not a named input type");
            }
            let validation = ContextValidation {
                parameter_position: position,
                path: nested_path.to_vec(),
                required: annotation.required,
                nullable: annotation.nullable,
                rule: "belongs_to_organization_if_present",
            };
            if let Some(existing) = validations.iter().find(|item| {
                item.parameter_position == validation.parameter_position
                    && item.path == validation.path
            }) {
                if existing.required != validation.required
                    || existing.nullable != validation.nullable
                {
                    bail!("reducer {reducer_name} has conflicting company path metadata");
                }
            } else {
                validations.push(validation);
            }
        }
    }

    for (position, param) in params.iter().enumerate() {
        let is_organization_context = organization_position == Some(position);
        if !is_organization_context {
            client_fields.push(ClientInputField {
                parameter_position: position,
            });
        }

        let source = if is_organization_context {
            WireArgumentSource::ServerContext {
                field: "organization_id",
            }
        } else {
            WireArgumentSource::ClientInput
        };
        wire_arguments.push(WireArgument {
            position,
            parameter_position: position,
            source,
        });

        if param.name == "organization_id" && !is_organization_context {
            bail!(
                "organization_id parameter at position {position} is not marked as server context"
            );
        }
    }

    if let Some(position) = organization_position {
        if position >= params.len() || params[position].name != "organization_id" {
            bail!("organization scope position {position} does not reference organization_id");
        }
    }
    if let Some(position) = company_position {
        if position >= params.len() || params[position].name != "company_id" {
            bail!("company scope position {position} does not reference company_id");
        }
    }

    // Keep these descriptors mechanically complete.  Every wire position must
    // be represented exactly once, and every non-server parameter must remain
    // available through client_input.
    if wire_arguments.len() != params.len()
        || wire_arguments
            .iter()
            .enumerate()
            .any(|(position, argument)| {
                argument.position != position || argument.parameter_position != position
            })
    {
        bail!("wire argument metadata does not cover reducer parameters exactly once");
    }
    let expected_client_fields = params.len() - usize::from(organization_position.is_some());
    if client_fields.len() != expected_client_fields {
        bail!("client input metadata omits or duplicates reducer parameters");
    }

    Ok((
        ClientInput {
            fields: client_fields,
        },
        ServerContext {
            fields: context_fields,
            validations,
        },
        wire_arguments,
    ))
}

fn resolve_type(
    ty: &Value,
    type_names: &BTreeMap<u64, String>,
) -> Result<(String, Option<String>)> {
    let object = ty.as_object().context("algebraic type must be an object")?;
    if object.len() != 1 {
        bail!("algebraic type must have exactly one variant: {ty}");
    }
    let (kind, payload) = object.iter().next().expect("length checked");
    if kind == "Ref" {
        let index = payload
            .as_u64()
            .context("algebraic Ref payload must be an integer")?;
        let target = type_names
            .get(&index)
            .cloned()
            .with_context(|| format!("typespace Ref {index} has no named target"))?;
        return Ok(("ref".to_owned(), Some(target)));
    }
    if kind == "Sum" {
        if let Some(variants) = payload.get("variants").and_then(Value::as_array) {
            if let Some(some_type) = variants.iter().find_map(|variant| {
                (variant.pointer("/name/some").and_then(Value::as_str) == Some("some"))
                    .then(|| variant.get("algebraic_type"))
                    .flatten()
            }) {
                let (inner_kind, ref_target) = resolve_type(some_type, type_names)?;
                return Ok((format!("option_{inner_kind}"), ref_target));
            }
        }
    }
    let normalized = match kind.as_str() {
        "Array" => "array",
        "Bool" => "bool",
        "F32" => "f32",
        "F64" => "f64",
        "I8" => "i8",
        "I16" => "i16",
        "I32" => "i32",
        "I64" => "i64",
        "I128" => "i128",
        "I256" => "i256",
        "Product"
            if payload
                .pointer("/elements/0/name/some")
                .and_then(Value::as_str)
                == Some("__identity__") =>
        {
            "identity"
        }
        "Product" => "product",
        "String" => "string",
        "Sum" => "sum",
        "U8" => "u8",
        "U16" => "u16",
        "U32" => "u32",
        "U64" => "u64",
        "U128" => "u128",
        "U256" => "u256",
        other => other,
    };
    Ok((normalized.to_owned(), None))
}

fn is_integer_kind(kind: &str) -> bool {
    matches!(
        kind,
        "u8" | "u16"
            | "u32"
            | "u64"
            | "u128"
            | "u256"
            | "i8"
            | "i16"
            | "i32"
            | "i64"
            | "i128"
            | "i256"
    )
}

fn is_optional_integer_kind(kind: &str) -> bool {
    kind.strip_prefix("option_").is_some_and(is_integer_kind)
}

fn lifecycle_name(lifecycle: Option<&Value>) -> String {
    let Some(lifecycle) = lifecycle else {
        return "none".to_owned();
    };
    if lifecycle.get("none").is_some() {
        return "none".to_owned();
    }
    lifecycle
        .pointer("/some")
        .and_then(Value::as_object)
        .and_then(|object| object.keys().next())
        .map(|name| name.to_ascii_lowercase())
        .unwrap_or_else(|| "unknown".to_owned())
}

fn emit_rust_contract(manifest: &ReducerManifest) -> String {
    let mut out =
        String::from("// @generated by lumiere-codegen from module-schema.json. Do not edit.\n\n");
    for (index, reducer) in manifest.reducers.iter().enumerate() {
        writeln!(out, "const PARAMS_{index}: &[ReducerParam] = &[").unwrap();
        for param in &reducer.params {
            writeln!(
                out,
                "    ReducerParam {{ name: {:?}, kind: ScalarKind::{}, ref_target: {} }},",
                param.name,
                rust_scalar_kind(&param.kind),
                option_string(param.ref_target.as_deref())
            )
            .unwrap();
        }
        out.push_str("];\n");
    }
    out.push_str("\npub const REDUCER_CONTRACTS: &[ReducerContract] = &[\n");
    for (index, reducer) in manifest.reducers.iter().enumerate() {
        let organization_position = reducer
            .scope
            .organization
            .as_ref()
            .map(|scope| scope.position);
        let company_position = reducer.scope.company.as_ref().map(|scope| scope.position);
        writeln!(
            out,
            "    ReducerContract {{ name: {:?}, params: PARAMS_{index}, lifecycle: {:?}, exposure: Exposure::{}, organization_position: {}, company_position: {}, unscoped_reason: {} }},",
            reducer.name,
            reducer.lifecycle,
            match reducer.exposure { Exposure::Denied => "Denied", Exposure::Session => "Session" },
            option_usize(organization_position),
            option_usize(company_position),
            option_string(reducer.unscoped_reason.as_deref()),
        ).unwrap();
    }
    out.push_str("];\n\npub fn company_scope_paths(reducer_name: &str) -> &'static [CompanyScopePath] {\n    match reducer_name {\n");
    for reducer in &manifest.reducers {
        let nested = reducer
            .server_context
            .validations
            .iter()
            .filter(|validation| !validation.path.is_empty())
            .collect::<Vec<_>>();
        if !nested.is_empty() {
            writeln!(
                out,
                "        {:?} => {},",
                reducer.name,
                rust_company_scope_paths(&nested)
            )
            .unwrap();
        }
    }
    out.push_str(
        "        _ => &[],\n    }\n}\n\npub mod reducer_names {\n    use super::ReducerName;\n",
    );
    for reducer in &manifest.reducers {
        writeln!(
            out,
            "    pub const {}: ReducerName = ReducerName::new({:?});",
            const_name(&reducer.name),
            reducer.name
        )
        .unwrap();
    }
    out.push_str("}\n");
    out.push_str("\n#[macro_export]\nmacro_rules! reducer_call {\n");
    for reducer in &manifest.reducers {
        writeln!(
            out,
            "    ({:?}, $args:expr $(,)?) => {{ $crate::ReducerCall::new($crate::reducer_names::{}, $args) }};",
            reducer.name,
            const_name(&reducer.name)
        )
        .unwrap();
    }
    out.push_str("}\n");
    out
}

fn rust_company_scope_paths(validations: &[&ContextValidation]) -> String {
    let entries = validations
        .iter()
        .map(|validation| {
            let path = validation
                .path
                .iter()
                .map(|segment| format!("{segment:?}"))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "CompanyScopePath {{ parameter_position: {}, path: &[{}], required: {}, nullable: {} }}",
                validation.parameter_position, path, validation.required, validation.nullable
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("&[{entries}]")
}

fn validate_binding_args(manifest: &ReducerManifest, bindings_dir: &std::path::Path) -> Result<()> {
    for reducer in &manifest.reducers {
        // Lifecycle reducers (`init`, connect, disconnect) are schema entries
        // but are not callable and therefore have no generated client Args.
        if reducer.lifecycle != "none" {
            continue;
        }
        let path = bindings_dir.join(format!("{}_reducer.rs", reducer.name));
        let source = read_to_string(&path).with_context(|| {
            format!("manifest reducer {} has no generated binding", reducer.name)
        })?;
        let args_start = source
            .find("Args {")
            .with_context(|| format!("{} contains no generated Args struct", path.display()))?;
        let body = &source[args_start + "Args {".len()..];
        let body = body
            .split_once("\n}")
            .map(|(body, _)| body)
            .with_context(|| format!("{} Args struct is unterminated", path.display()))?;
        let binding_fields: Vec<&str> = body
            .lines()
            .filter_map(|line| line.trim().strip_prefix("pub "))
            .filter_map(|field| field.split_once(':').map(|(name, _)| name.trim()))
            .collect();
        let manifest_fields: Vec<&str> = reducer
            .params
            .iter()
            .map(|param| param.name.as_str())
            .collect();
        if binding_fields != manifest_fields {
            bail!(
                "reducer {} schema params {:?} do not match generated Args fields {:?}",
                reducer.name,
                manifest_fields,
                binding_fields
            );
        }
    }
    Ok(())
}

fn emit_typescript_exposure(manifest: &ReducerManifest) -> String {
    let mut out = String::from(
        "// @generated by lumiere-codegen. Do not edit.\nexport const STDB_BFF_REDUCERS = [\n",
    );
    for reducer in manifest
        .reducers
        .iter()
        .filter(|reducer| reducer.exposure == Exposure::Session)
    {
        writeln!(out, "  {:?},", reducer.name).unwrap();
    }
    out.push_str(
        "] as const;\n\nexport type StdbBffReducerKey = (typeof STDB_BFF_REDUCERS)[number];\n",
    );
    out
}

fn rust_scalar_kind(kind: &str) -> &'static str {
    match kind {
        "bool" => "Bool",
        "f32" | "f64" => "Float",
        "option_bool" => "OptionalBool",
        "option_f32" | "option_f64" => "OptionalFloat",
        "option_i8" | "option_i16" | "option_i32" | "option_i64" | "option_i128"
        | "option_i256" => "OptionalSignedInteger",
        "option_u8" | "option_u16" | "option_u32" | "option_u64" | "option_u128"
        | "option_u256" => "OptionalUnsignedInteger",
        "option_string" => "OptionalString",
        "i8" | "i16" | "i32" | "i64" | "i128" | "i256" => "SignedInteger",
        "u8" | "u16" | "u32" | "u64" | "u128" | "u256" => "UnsignedInteger",
        "string" => "String",
        _ => "Composite",
    }
}

fn option_string(value: Option<&str>) -> String {
    value.map_or_else(|| "None".to_owned(), |value| format!("Some({value:?})"))
}

fn option_usize(value: Option<usize>) -> String {
    value.map_or_else(|| "None".to_owned(), |value| format!("Some({value})"))
}

fn const_name(name: &str) -> String {
    name.to_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn param(name: &str, kind: &str) -> ReducerParam {
        ReducerParam {
            name: name.to_owned(),
            kind: kind.to_owned(),
            ref_target: None,
        }
    }

    #[test]
    fn resolves_named_refs() {
        let names = BTreeMap::from([(7, "ExampleParams".to_owned())]);
        let (kind, target) = resolve_type(&serde_json::json!({"Ref": 7}), &names).unwrap();
        assert_eq!(kind, "ref");
        assert_eq!(target.as_deref(), Some("ExampleParams"));
    }

    #[test]
    fn recognizes_identity_product() {
        let identity = serde_json::json!({"Product":{"elements":[{"name":{"some":"__identity__"},"algebraic_type":{"U256":[]}}]}});
        assert_eq!(
            resolve_type(&identity, &BTreeMap::new()).unwrap().0,
            "identity"
        );
    }

    #[test]
    fn rejects_exposure_entry_for_nonexistent_reducer() {
        let exposure = BTreeMap::from([(
            "confirm_sale_order".to_owned(),
            ExposureEntry {
                name: "confirm_sale_order".to_owned(),
                exposure: Exposure::Session,
                reason: "test".to_owned(),
                unscoped_reason: Some("test".to_owned()),
            },
        )]);
        let schema_names = BTreeSet::from(["confirm_sales_order"]);
        assert!(validate_exposure_names(&exposure, &schema_names).is_err());
    }

    #[test]
    fn input_metadata_injects_organization_but_keeps_company_client_selected() {
        let params = vec![
            param("organization_id", "u64"),
            param("company_id", "u64"),
            param("order_id", "u64"),
        ];
        let scope = ReducerScope {
            organization: Some(ScopeParam {
                parameter: "organization_id",
                position: 0,
            }),
            company: Some(ScopeParam {
                parameter: "company_id",
                position: 1,
            }),
        };

        let (client_input, server_context, wire_arguments) =
            build_input_metadata("test_reducer", &params, &scope, None).unwrap();

        assert_eq!(
            client_input
                .fields
                .iter()
                .map(|field| field.parameter_position)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert_eq!(server_context.fields.len(), 1);
        assert_eq!(server_context.fields[0].parameter_position, 0);
        assert_eq!(server_context.fields[0].name, "organization_id");
        assert_eq!(
            server_context.fields[0].source,
            "authenticated_session.organization_id"
        );
        assert_eq!(server_context.validations.len(), 1);
        assert_eq!(server_context.validations[0].parameter_position, 1);
        assert!(server_context.validations[0].path.is_empty());
        assert_eq!(
            server_context.validations[0].rule,
            "belongs_to_organization_if_present"
        );
        assert!(matches!(
            wire_arguments[0].source,
            WireArgumentSource::ServerContext {
                field: "organization_id"
            }
        ));
        assert!(matches!(
            wire_arguments[1].source,
            WireArgumentSource::ClientInput
        ));
        assert!(matches!(
            wire_arguments[2].source,
            WireArgumentSource::ClientInput
        ));
    }

    #[test]
    fn input_metadata_keeps_unscoped_parameters_as_client_input() {
        let params = vec![param("token", "string"), param("serial", "string")];
        let (client_input, server_context, wire_arguments) =
            build_input_metadata("test_reducer", &params, &ReducerScope::default(), None).unwrap();

        assert_eq!(
            client_input
                .fields
                .iter()
                .map(|field| field.parameter_position)
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
        assert!(server_context.fields.is_empty());
        assert!(server_context.validations.is_empty());
        assert!(wire_arguments
            .iter()
            .all(|argument| matches!(argument.source, WireArgumentSource::ClientInput)));
    }

    #[test]
    fn input_metadata_references_nested_company_scope_without_copying_its_type() {
        let params = vec![
            param("organization_id", "u64"),
            ReducerParam {
                name: "params".to_owned(),
                kind: "ref".to_owned(),
                ref_target: Some("CreateContactParams".to_owned()),
            },
        ];
        let scope = ReducerScope {
            organization: Some(ScopeParam {
                parameter: "organization_id",
                position: 0,
            }),
            company: None,
        };
        let company_scope = CompanyScopeReducer {
            name: "create_contact".to_owned(),
            company_paths: vec![CompanyPathAnnotation {
                path: vec!["params".to_owned(), "company_id".to_owned()],
                required: false,
                nullable: true,
            }],
            asserts_no_company_parameter: false,
        };

        let (_, server_context, _) =
            build_input_metadata("create_contact", &params, &scope, Some(&company_scope)).unwrap();
        assert_eq!(server_context.validations.len(), 1);
        let validation = &server_context.validations[0];
        assert_eq!(validation.parameter_position, 1);
        assert_eq!(validation.path, ["company_id"]);
        assert!(!validation.required);
        assert!(validation.nullable);
    }

    #[test]
    fn input_metadata_rejects_scope_positions_that_do_not_match_parameter_names() {
        let params = vec![param("organization_id", "u64")];
        let scope = ReducerScope {
            organization: Some(ScopeParam {
                parameter: "organization_id",
                position: 1,
            }),
            company: None,
        };

        assert!(build_input_metadata("test_reducer", &params, &scope, None).is_err());
    }
}
