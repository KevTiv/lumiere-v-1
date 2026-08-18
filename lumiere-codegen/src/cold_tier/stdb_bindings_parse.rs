//! Parser for SpacetimeDB-generated Rust client bindings.
//!
//! Reads `api-server/src/stdb_sdk_bindings/` and extracts the stable Lumiere
//! schema IR without depending on a Rust parser crate.  The generated files have
//! a highly regular format produced by the SpacetimeDB code generator; we rely
//! on that regularity instead of a full AST.
//!
//! ## Extraction strategy
//!
//! **From `*_table.rs` files** (one per table):
//! ```text
//! let _table = client_cache.get_or_make_table::<TypeName>("sql_name");
//! _table.add_unique_constraint::<pk_type>("pk_field", ...);
//! ```
//!
//! **From `*_type.rs` files** (one per type):
//! - `pub struct TypeName { pub field: Type, ... }` → columns
//! - `pub struct TypeNameIxCols { pub col: IxCol<...>, ... }` → indexed columns
//! - `pub enum TypeName { Variant, ... }` → enum types

use anyhow::{bail, Context, Result};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::cold_tier::schema_ir::{
    GeneratedColumn, GeneratedEnumType, GeneratedIndex, GeneratedPrimaryKey, GeneratedTableSchema,
    GeneratedType, LumiereSchemaManifest,
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Parse all `*_table.rs` and `*_type.rs` files in `bindings_dir` and return
/// the complete schema manifest.
pub fn parse_bindings(bindings_dir: &Path) -> Result<LumiereSchemaManifest> {
    // Pass 1: scan every *_type.rs to build a map of type-name → kind.
    // This is needed to resolve field types like `MoveType` → Enum.
    let type_kind_map =
        scan_type_kinds(bindings_dir).context("scanning *_type.rs files for kind map")?;

    // Pass 2: parse every *_table.rs to collect table descriptors.
    let table_infos = parse_table_files(bindings_dir).context("parsing *_table.rs files")?;

    // Pass 3: for each table, parse the corresponding *_type.rs for column info.
    let mut tables: Vec<GeneratedTableSchema> = Vec::with_capacity(table_infos.len());
    for info in &table_infos {
        // Use the type_module extracted from the import statement in the table file.
        let type_file = bindings_dir.join(format!("{}_type.rs", info.type_module));
        if !type_file.exists() {
            eprintln!(
                "lumiere-codegen: warning: type file not found for table '{}' (expected {})",
                info.sql_name,
                type_file.display()
            );
            continue;
        }
        let type_src = fs::read_to_string(&type_file)
            .with_context(|| format!("read {}", type_file.display()))?;

        let fields = parse_struct_fields(&type_src, &info.rust_type_name)
            .with_context(|| format!("parse struct {} fields", info.rust_type_name))?;

        let ix_col_names = parse_ix_cols(&type_src, &info.rust_type_name);

        let pk_ty = parse_type_str(&info.pk_type_str, &type_kind_map).with_context(|| {
            format!(
                "resolve PK type '{}' for table '{}'",
                info.pk_type_str, info.sql_name
            )
        })?;

        let mut columns: Vec<GeneratedColumn> = Vec::with_capacity(fields.len());
        for (raw_name, raw_type) in &fields {
            let (nullable, inner_str) = strip_option(raw_type.as_str());
            let ty = parse_type_str(inner_str, &type_kind_map).with_context(|| {
                format!(
                    "resolve field type '{}' in {}.{}",
                    raw_type, info.rust_type_name, raw_name
                )
            })?;
            columns.push(GeneratedColumn {
                name: raw_name.clone(),
                sql_name: raw_name.clone(),
                ty,
                nullable,
            });
        }

        // Indexes: every IxCol that is not the PK column becomes a B-tree
        // index.  The PK already has its own unique constraint; a column that
        // also appears in a secondary `add_unique_constraint::<..>(...)` call
        // (a `#[unique]` field) must keep its unique index instead of being
        // downgraded to a plain non-unique one.
        let indexes: Vec<GeneratedIndex> = ix_col_names
            .iter()
            .filter(|col| *col != &info.pk_field)
            .map(|col| GeneratedIndex {
                name: format!("{}_{}", info.sql_name, col),
                columns: vec![col.clone()],
                unique: info.secondary_unique_fields.contains(col),
            })
            .collect();

        tables.push(GeneratedTableSchema {
            rust_name: info.rust_type_name.clone(),
            sql_name: info.sql_name.clone(),
            primary_key: GeneratedPrimaryKey {
                column_name: info.pk_field.clone(),
                ty: pk_ty,
            },
            columns,
            indexes,
        });
    }

    tables.sort_by(|a, b| a.sql_name.cmp(&b.sql_name));

    // Collect enum types from the kind map.
    let mut enum_types: Vec<GeneratedEnumType> = type_kind_map
        .into_iter()
        .filter_map(|(name, kind)| {
            if let TypeKind::Enum { variants } = kind {
                Some(GeneratedEnumType {
                    rust_name: name,
                    variants,
                })
            } else {
                None
            }
        })
        .collect();
    enum_types.sort_by(|a, b| a.rust_name.cmp(&b.rust_name));

    Ok(LumiereSchemaManifest {
        version: 1,
        tables,
        enum_types,
    })
}

// ---------------------------------------------------------------------------
// Internal data structures
// ---------------------------------------------------------------------------

struct TableFileInfo {
    rust_type_name: String,
    /// snake_case module name for the type file, e.g. `"document_folder"` for
    /// type `DocumentFolder`.  Extracted from `use super::{module}_type::...`.
    type_module: String,
    sql_name: String,
    pk_field: String,
    pk_type_str: String,
    /// Field names from every `add_unique_constraint::<..>("field", ...)` call
    /// after the first (the first is the primary key, captured in `pk_field`).
    /// These correspond to `#[unique]` columns and must produce a unique index,
    /// not a plain B-tree index.
    secondary_unique_fields: Vec<String>,
}

pub(crate) enum TypeKind {
    Struct,
    Enum { variants: Vec<String> },
}

// ---------------------------------------------------------------------------
// Pass 1: scan *_type.rs for kind map
// ---------------------------------------------------------------------------

fn scan_type_kinds(bindings_dir: &Path) -> Result<BTreeMap<String, TypeKind>> {
    let mut map = BTreeMap::new();

    let entries = fs::read_dir(bindings_dir)
        .with_context(|| format!("read dir {}", bindings_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.ends_with("_type.rs") {
            continue;
        }

        let src = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;

        // A type file defines exactly one top-level pub struct or pub enum.
        for line in src.lines() {
            let trimmed = line.trim();
            if let Some(kind) = try_parse_struct_decl(trimmed) {
                map.insert(kind, TypeKind::Struct);
                break;
            }
            if let Some((name, variants)) = try_parse_enum_decl(trimmed, &src) {
                map.insert(name, TypeKind::Enum { variants });
                break;
            }
        }
    }

    Ok(map)
}

/// If `line` is `pub struct Foo {` (possibly `pub struct Foo<...> {`), return `"Foo"`.
fn try_parse_struct_decl(line: &str) -> Option<String> {
    let rest = line.strip_prefix("pub struct ")?;
    // Struct name ends at whitespace, `{`, or `<`
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        return None;
    }
    Some(name)
}

/// If `line` is `pub enum Foo {`, return `("Foo", [variants...])` by scanning `src`.
fn try_parse_enum_decl(line: &str, src: &str) -> Option<(String, Vec<String>)> {
    let rest = line.strip_prefix("pub enum ")?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        return None;
    }
    let variants = extract_enum_variants(src, &name);
    Some((name, variants))
}

fn extract_enum_variants(src: &str, enum_name: &str) -> Vec<String> {
    let mut variants = Vec::new();
    let mut in_enum = false;
    let mut brace_depth: i32 = 0;

    for line in src.lines() {
        let trimmed = line.trim();

        if !in_enum {
            if trimmed.starts_with(&format!("pub enum {}", enum_name)) && trimmed.ends_with('{') {
                in_enum = true;
                brace_depth = 1;
                continue;
            }
        } else {
            // Count braces
            for ch in trimmed.chars() {
                match ch {
                    '{' => brace_depth += 1,
                    '}' => brace_depth -= 1,
                    _ => {}
                }
            }
            if brace_depth <= 0 {
                break;
            }
            // A variant line at depth 1: simple identifier followed by `,`, `{`, `(`, or end-of-line.
            // Skip comment lines.
            if trimmed.starts_with("//") || trimmed.is_empty() {
                continue;
            }
            if brace_depth == 1 {
                let variant: String = trimmed
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if !variant.is_empty() {
                    variants.push(variant);
                }
            }
        }
    }

    variants
}

// ---------------------------------------------------------------------------
// Pass 2: parse *_table.rs files
// ---------------------------------------------------------------------------

fn parse_table_files(bindings_dir: &Path) -> Result<Vec<TableFileInfo>> {
    let mut infos = Vec::new();

    let entries = fs::read_dir(bindings_dir)
        .with_context(|| format!("read dir {}", bindings_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !file_name.ends_with("_table.rs") {
            continue;
        }

        let src = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;

        match parse_table_file_src(&src, file_name) {
            Ok(info) => infos.push(info),
            Err(e) => {
                eprintln!("lumiere-codegen: warning: skipping {}: {}", file_name, e);
            }
        }
    }

    infos.sort_by(|a, b| a.sql_name.cmp(&b.sql_name));
    Ok(infos)
}

fn parse_table_file_src(src: &str, file_name: &str) -> Result<TableFileInfo> {
    // ── extract from get_or_make_table::<TypeName>("sql_name") ──────────────
    let marker_table = "get_or_make_table::<";
    let pos = src
        .find(marker_table)
        .with_context(|| format!("'{}': get_or_make_table not found", file_name))?;
    let after = &src[pos + marker_table.len()..];

    let gt = after
        .find('>')
        .with_context(|| format!("'{}': missing '>' after TypeName", file_name))?;
    let rust_type_name = after[..gt].trim().to_string();

    let after_gt = &after[gt + 1..];
    let q1 = after_gt
        .find('"')
        .with_context(|| format!("'{}': missing '\"' after get_or_make_table type", file_name))?;
    let after_q1 = &after_gt[q1 + 1..];
    let q2 = after_q1
        .find('"')
        .with_context(|| format!("'{}': missing closing '\"' for sql_name", file_name))?;
    let sql_name = after_q1[..q2].to_string();

    // ── extract from add_unique_constraint::<pk_type>("pk_field", ...) ──────
    let marker_uq = "add_unique_constraint::<";
    let pos_uq = src
        .find(marker_uq)
        .with_context(|| format!("'{}': add_unique_constraint not found (no PK?)", file_name))?;
    let after_uq = &src[pos_uq + marker_uq.len()..];

    let gt_uq = after_uq
        .find('>')
        .with_context(|| format!("'{}': missing '>' after PK type", file_name))?;
    let pk_type_str = after_uq[..gt_uq].trim().to_string();

    let after_gt_uq = &after_uq[gt_uq + 1..];
    let q1_uq = after_gt_uq
        .find('"')
        .with_context(|| format!("'{}': missing '\"' after PK type", file_name))?;
    let after_q1_uq = &after_gt_uq[q1_uq + 1..];
    let q2_uq = after_q1_uq
        .find('"')
        .with_context(|| format!("'{}': missing closing '\"' for pk_field", file_name))?;
    let pk_field = after_q1_uq[..q2_uq].to_string();

    // ── extract every subsequent add_unique_constraint::<..>("field", ...) ──
    // These are `#[unique]` columns beyond the primary key; each must produce
    // a *unique* index in the generated PG DDL, not a plain B-tree index.
    let mut secondary_unique_fields: Vec<String> = Vec::new();
    let mut scan_from = pos_uq + marker_uq.len();
    while let Some(rel) = src[scan_from..].find(marker_uq) {
        let pos = scan_from + rel;
        let after = &src[pos + marker_uq.len()..];
        let Some(gt) = after.find('>') else { break };
        let after_gt = &after[gt + 1..];
        let Some(q1) = after_gt.find('"') else { break };
        let after_q1 = &after_gt[q1 + 1..];
        let Some(q2) = after_q1.find('"') else { break };
        let field = after_q1[..q2].to_string();
        if !field.is_empty() && field != pk_field {
            secondary_unique_fields.push(field);
        }
        scan_from = pos + marker_uq.len();
    }

    if rust_type_name.is_empty() || sql_name.is_empty() || pk_field.is_empty() {
        bail!(
            "'{}': extracted empty value (rust_name='{}', sql='{}', pk='{}')",
            file_name,
            rust_type_name,
            sql_name,
            pk_field
        );
    }

    // Extract the type module name from `use super::{module}_type::{TypeName};`.
    // This is more reliable than camel_to_snake when the SQL name and type name differ.
    let type_module = extract_type_module_from_imports(src, &rust_type_name)
        .unwrap_or_else(|| camel_to_snake(&rust_type_name));

    Ok(TableFileInfo {
        rust_type_name,
        type_module,
        sql_name,
        pk_field,
        pk_type_str,
        secondary_unique_fields,
    })
}

// ---------------------------------------------------------------------------
// Pass 3: parse struct and IxCols from *_type.rs
// ---------------------------------------------------------------------------

/// Parse `pub field: Type,` lines from the primary struct definition.
///
/// Returns `(field_name, raw_type_string)` pairs.  Raw identifier prefixes
/// (`r#`) are stripped from field names.
fn parse_struct_fields(src: &str, struct_name: &str) -> Result<Vec<(String, String)>> {
    let mut fields = Vec::new();
    let mut in_struct = false;
    let mut brace_depth: i32 = 0;

    for line in src.lines() {
        let trimmed = line.trim();

        if !in_struct {
            // The generated format is always `pub struct Name {` on one line.
            if trimmed.starts_with(&format!("pub struct {}", struct_name))
                && (trimmed.ends_with('{') || trimmed.contains(" {"))
            {
                in_struct = true;
                brace_depth = 1;
                continue;
            }
        } else {
            for ch in trimmed.chars() {
                match ch {
                    '{' => brace_depth += 1,
                    '}' => brace_depth -= 1,
                    _ => {}
                }
            }
            if brace_depth <= 0 {
                break;
            }
            // Fields are at brace_depth == 1.
            if brace_depth == 1 {
                if let Some(field) = try_parse_field_line(trimmed) {
                    fields.push(field);
                }
            }
        }
    }

    if !in_struct {
        bail!("struct '{}' not found in type file", struct_name);
    }

    Ok(fields)
}

/// Parse `pub {name}: {type},` or `pub r#{name}: {type},`.
///
/// Returns `(field_name, type_string)`.
fn try_parse_field_line(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("pub ")?;
    // Skip nested struct or other declarations inside the body
    if rest.starts_with("struct ") || rest.starts_with("enum ") || rest.starts_with("fn ") {
        return None;
    }
    // Find ": " separator
    let colon = rest.find(": ")?;
    let raw_name = rest[..colon].trim();
    // Strip raw identifier prefix
    let name = raw_name.trim_start_matches("r#").to_string();
    if name.is_empty() {
        return None;
    }
    let raw_type = rest[colon + 2..]
        .trim()
        .trim_end_matches(',')
        .trim()
        .to_string();
    if raw_type.is_empty() {
        return None;
    }
    Some((name, raw_type))
}

/// Extract the column names from `pub struct {TypeName}IxCols { ... }`.
///
/// The IxCols struct lists every indexed column (including the PK).
fn parse_ix_cols(src: &str, struct_name: &str) -> Vec<String> {
    let ix_marker = format!("pub struct {}IxCols", struct_name);
    let mut cols = Vec::new();
    let mut in_ix = false;
    let mut brace_depth: i32 = 0;

    for line in src.lines() {
        let trimmed = line.trim();

        if !in_ix {
            if trimmed.starts_with(&ix_marker) && (trimmed.ends_with('{') || trimmed.contains(" {"))
            {
                in_ix = true;
                brace_depth = 1;
                continue;
            }
        } else {
            for ch in trimmed.chars() {
                match ch {
                    '{' => brace_depth += 1,
                    '}' => brace_depth -= 1,
                    _ => {}
                }
            }
            if brace_depth <= 0 {
                break;
            }
            if brace_depth == 1 {
                if let Some(col) = try_extract_ix_col_name(trimmed) {
                    cols.push(col);
                }
            }
        }
    }

    cols
}

/// From `pub col_name: __sdk::__query_builder::IxCol<...>,`, extract `"col_name"`.
fn try_extract_ix_col_name(line: &str) -> Option<String> {
    let rest = line.strip_prefix("pub ")?;
    let colon = rest.find(':')?;
    let name = rest[..colon].trim().trim_start_matches("r#").to_string();
    if name.is_empty() {
        return None;
    }
    Some(name)
}

// ---------------------------------------------------------------------------
// CamelCase → snake_case
// ---------------------------------------------------------------------------

/// Extract the type module name from the `use super::` imports in a table file.
///
/// Looks for `use super::{module}_type::{type_name};` and returns `module`.
///
/// The trailing `;` is required to prevent `AccountMove` from matching
/// `AccountMoveState` (prefix collision).
fn extract_type_module_from_imports(src: &str, type_name: &str) -> Option<String> {
    // Require the exact type name followed by `;` to avoid prefix matches.
    let suffix = format!("_type::{};", type_name);
    for line in src.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("use super::") {
            if let Some(module_end) = rest.find(&suffix) {
                let module = rest[..module_end].to_string();
                if !module.is_empty() {
                    return Some(module);
                }
            }
        }
    }
    None
}

/// Convert a CamelCase identifier to snake_case.
///
/// `"DocumentFolder"` → `"document_folder"`, `"AuditLog"` → `"audit_log"`.
fn camel_to_snake(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            out.push('_');
        }
        out.extend(ch.to_lowercase());
    }
    out
}

// ---------------------------------------------------------------------------
// Type string → GeneratedType
// ---------------------------------------------------------------------------

/// Strip a single layer of `Option<T>`, returning `(is_nullable, inner_str)`.
pub fn strip_option(type_str: &str) -> (bool, &str) {
    if type_str.starts_with("Option<") && type_str.ends_with('>') {
        (true, &type_str[7..type_str.len() - 1])
    } else {
        (false, type_str)
    }
}

/// Recursively convert a raw type string from the generated bindings into a
/// `GeneratedType`.
///
/// Unrecognised type names are resolved against `kind_map`:
/// - known `Enum` → `GeneratedType::Enum`
/// - known `Struct` → `GeneratedType::Struct`
/// - absent from `kind_map` → an error (see the `None` arm below); this is
///   never a struct-shaped guess, so an SDK type that isn't a user-defined
///   struct/enum (e.g. `__sdk::ScheduleAt`) must be listed explicitly here.
pub fn parse_type_str(s: &str, kind_map: &BTreeMap<String, TypeKind>) -> Result<GeneratedType> {
    let s = s.trim();
    match s {
        "u8" => return Ok(GeneratedType::U8),
        "u16" => return Ok(GeneratedType::U16),
        "u32" => return Ok(GeneratedType::U32),
        "u64" => return Ok(GeneratedType::U64),
        "i8" => return Ok(GeneratedType::I8),
        "i16" => return Ok(GeneratedType::I16),
        "i32" => return Ok(GeneratedType::I32),
        "i64" => return Ok(GeneratedType::I64),
        "f32" => return Ok(GeneratedType::F32),
        "f64" => return Ok(GeneratedType::F64),
        "bool" => return Ok(GeneratedType::Bool),
        "String" => return Ok(GeneratedType::String),
        "__sdk::Identity" => return Ok(GeneratedType::Identity),
        "__sdk::Timestamp" => return Ok(GeneratedType::Timestamp),
        // Scheduled-reducer marker (`enum ScheduleAt { Time(Timestamp), Interval(TimeDuration) }`
        // in the SDK). Not a user struct/enum in kind_map, so it must be named
        // here explicitly; encoded the same way a Struct would be (JSONB).
        "__sdk::ScheduleAt" => return Ok(GeneratedType::Struct("ScheduleAt".to_string())),
        _ => {}
    }

    if s.starts_with("Vec<") && s.ends_with('>') {
        let inner_str = &s[4..s.len() - 1];
        // Strip an inner Option if present (Vec<Option<T>> → Vec(T) nullable item;
        // we represent the inner type only, as PG JSONB encodes the array).
        let (_, inner) = strip_option(inner_str);
        let inner_ty = parse_type_str(inner, kind_map)
            .with_context(|| format!("resolving Vec inner type '{}'", inner_str))?;
        return Ok(GeneratedType::Vec(Box::new(inner_ty)));
    }

    if s.starts_with("Option<") && s.ends_with('>') {
        // Nested Option — unwrap and recurse (unusual but handled gracefully).
        let inner = &s[7..s.len() - 1];
        return parse_type_str(inner, kind_map);
    }

    // User-defined type — check kind map.  A name absent from the map is a
    // scan gap (module not indexed, typo, or new generator output shape), not
    // evidence of a struct — treat it as an error rather than silently
    // guessing JSONB, since a wrong guess here produces PG DDL/codecs that
    // diverge from the real STDB representation with no build-time signal.
    match kind_map.get(s) {
        Some(TypeKind::Enum { .. }) => Ok(GeneratedType::Enum(s.to_string())),
        Some(TypeKind::Struct) => Ok(GeneratedType::Struct(s.to_string())),
        None => bail!(
            "unrecognized type '{}': not found among scanned *_type.rs struct/enum definitions",
            s
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn empty_map() -> BTreeMap<String, TypeKind> {
        BTreeMap::new()
    }

    #[test]
    fn parse_primitives() {
        let m = empty_map();
        assert_eq!(parse_type_str("u64", &m).unwrap(), GeneratedType::U64);
        assert_eq!(parse_type_str("String", &m).unwrap(), GeneratedType::String);
        assert_eq!(
            parse_type_str("__sdk::Identity", &m).unwrap(),
            GeneratedType::Identity
        );
        assert_eq!(
            parse_type_str("__sdk::Timestamp", &m).unwrap(),
            GeneratedType::Timestamp
        );
    }

    #[test]
    fn parse_option_wrapping() {
        let (nullable, inner) = strip_option("Option<u64>");
        assert!(nullable);
        assert_eq!(inner, "u64");

        let (nullable, inner) = strip_option("u64");
        assert!(!nullable);
        assert_eq!(inner, "u64");
    }

    #[test]
    fn parse_vec() {
        let m = empty_map();
        assert_eq!(
            parse_type_str("Vec<String>", &m).unwrap(),
            GeneratedType::Vec(Box::new(GeneratedType::String))
        );
    }

    #[test]
    fn parse_enum_type() {
        let mut m = BTreeMap::new();
        m.insert(
            "AccountMoveState".to_string(),
            TypeKind::Enum {
                variants: vec!["Draft".into(), "Posted".into()],
            },
        );
        assert_eq!(
            parse_type_str("AccountMoveState", &m).unwrap(),
            GeneratedType::Enum("AccountMoveState".to_string())
        );
    }

    #[test]
    fn parse_table_src() {
        let src = r#"
pub(super) fn register_table(client_cache: &mut __sdk::ClientCache<super::RemoteModule>) {
    let _table = client_cache.get_or_make_table::<AuditLog>("audit_log");
    _table.add_unique_constraint::<u64>("id", |row| &row.id);
}
"#;
        let info = parse_table_file_src(src, "audit_log_table.rs").unwrap();
        assert_eq!(info.rust_type_name, "AuditLog");
        assert_eq!(info.sql_name, "audit_log");
        assert_eq!(info.pk_field, "id");
        assert_eq!(info.pk_type_str, "u64");
    }

    #[test]
    fn parse_struct_fields_basic() {
        let src = r#"
pub struct AuditLog {
    pub id: u64,
    pub organization_id: u64,
    pub company_id: Option<u64>,
    pub table_name: String,
    pub changed_fields: Vec<String>,
    pub user_identity: __sdk::Identity,
    pub r#ref: Option<String>,
}
"#;
        let fields = parse_struct_fields(src, "AuditLog").unwrap();
        assert_eq!(fields[0], ("id".to_string(), "u64".to_string()));
        assert_eq!(
            fields[2],
            ("company_id".to_string(), "Option<u64>".to_string())
        );
        assert_eq!(
            fields[4],
            ("changed_fields".to_string(), "Vec<String>".to_string())
        );
        assert_eq!(
            fields[5],
            ("user_identity".to_string(), "__sdk::Identity".to_string())
        );
        assert_eq!(fields[6], ("ref".to_string(), "Option<String>".to_string()));
    }

    #[test]
    fn parse_ix_cols_basic() {
        let src = r#"
pub struct AuditLogIxCols {
    pub id: __sdk::__query_builder::IxCol<AuditLog, u64>,
    pub organization_id: __sdk::__query_builder::IxCol<AuditLog, u64>,
    pub table_name: __sdk::__query_builder::IxCol<AuditLog, String>,
}
"#;
        let cols = parse_ix_cols(src, "AuditLog");
        assert_eq!(cols, vec!["id", "organization_id", "table_name"]);
    }
}
