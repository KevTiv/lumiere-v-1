//! Country-pack helpers for document search locale, residency, and fiscal archive kinds.

use spacetimedb::{ReducerContext, Table};

use crate::core::country_pack::{company_country_pack, country_pack_definition};

pub(crate) const MAX_INDEX_CONTENT_CHARS: usize = 32_768;

fn pack_metadata_json(meta: &Option<String>) -> Option<serde_json::Value> {
    let raw = meta.as_ref()?;
    serde_json::from_str(raw).ok()
}

pub(crate) fn company_pack_string(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    key: &str,
) -> Option<String> {
    let company_id = company_id?;
    for pack in ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .filter(|p| p.organization_id == organization_id && p.enabled)
    {
        let Some(def) = ctx
            .db
            .country_pack_definition()
            .iter()
            .find(|definition| {
                definition.organization_id == organization_id
                    && definition.pack_key == pack.pack_key
            })
        else {
            continue;
        };
        if let Some(v) = pack_metadata_json(&def.metadata)
            .and_then(|m| m.get(key).cloned())
            .and_then(|v| v.as_str().map(|s| s.to_string()))
        {
            if !v.trim().is_empty() {
                return Some(v);
            }
        }
    }
    None
}

pub(crate) fn company_pack_string_list(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    key: &str,
) -> Vec<String> {
    let Some(company_id) = company_id else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for pack in ctx
        .db
        .company_country_pack()
        .company_country_pack_by_company()
        .filter(&company_id)
        .filter(|p| p.organization_id == organization_id && p.enabled)
    {
        let Some(def) = ctx
            .db
            .country_pack_definition()
            .iter()
            .find(|definition| {
                definition.organization_id == organization_id
                    && definition.pack_key == pack.pack_key
            })
        else {
            continue;
        };
        let Some(meta) = pack_metadata_json(&def.metadata) else {
            continue;
        };
        if let Some(arr) = meta.get(key).and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    let t = s.trim();
                    if !t.is_empty() && !out.iter().any(|x| x == t) {
                        out.push(t.to_string());
                    }
                }
            }
        }
    }
    out
}

pub(crate) fn document_search_language_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Option<String> {
    company_pack_string(ctx, organization_id, company_id, "document_search_language")
}

pub(crate) fn document_search_analyzer_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Option<String> {
    company_pack_string(ctx, organization_id, company_id, "document_search_analyzer")
}

pub(crate) fn document_residency_region_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Option<String> {
    company_pack_string(
        ctx,
        organization_id,
        company_id,
        "document_residency_region",
    )
}

pub(crate) fn fiscal_archive_kinds_for_company(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
) -> Vec<String> {
    company_pack_string_list(ctx, organization_id, company_id, "fiscal_archive_kinds")
}

fn fiscal_kind_allowed_mimetypes(kind: &str) -> &'static [&'static str] {
    match kind {
        "nfe_xml" | "myinvois_xml" | "efaktur_xml" => {
            &["application/xml", "text/xml", "application/xhtml+xml"]
        }
        "nfe_pdf" | "efaktur_pdf" | "danfe_pdf" | "tax_invoice_pdf" => &["application/pdf"],
        _ => &[],
    }
}

pub(crate) fn validate_fiscal_archive(
    ctx: &ReducerContext,
    organization_id: u64,
    company_id: Option<u64>,
    fiscal_kind: &str,
    mimetype: &str,
) -> Result<(), String> {
    let kind = fiscal_kind.trim();
    if kind.is_empty() {
        return Ok(());
    }
    let expected = fiscal_archive_kinds_for_company(ctx, organization_id, company_id);
    if !expected.is_empty() && !expected.iter().any(|k| k == kind) {
        return Err(format!(
            "fiscal_kind '{}' is not expected by enabled country packs (allowed: {})",
            kind,
            expected.join(", ")
        ));
    }
    let allowed = fiscal_kind_allowed_mimetypes(kind);
    if allowed.is_empty() {
        return Err(format!("unknown fiscal_kind '{}'", kind));
    }
    let mt = mimetype.trim().to_ascii_lowercase();
    if !allowed.iter().any(|a| *a == mt) {
        return Err(format!(
            "fiscal_kind '{}' requires MIME one of [{}], got '{}'",
            kind,
            allowed.join(", "),
            mimetype
        ));
    }
    Ok(())
}

pub(crate) fn build_default_index_content(
    name: &str,
    description: Option<&str>,
    file_name: &str,
    extra: Option<&str>,
) -> String {
    let mut parts = vec![name.trim().to_string(), file_name.trim().to_string()];
    if let Some(d) = description {
        let t = d.trim();
        if !t.is_empty() {
            parts.push(t.to_string());
        }
    }
    if let Some(e) = extra {
        let t = e.trim();
        if !t.is_empty() {
            parts.push(t.to_string());
        }
    }
    let joined = parts.join("\n");
    if joined.chars().count() > MAX_INDEX_CONTENT_CHARS {
        joined.chars().take(MAX_INDEX_CONTENT_CHARS).collect()
    } else {
        joined
    }
}

pub(crate) fn truncate_index_content(content: &str) -> String {
    let t = content.trim();
    if t.chars().count() > MAX_INDEX_CONTENT_CHARS {
        t.chars().take(MAX_INDEX_CONTENT_CHARS).collect()
    } else {
        t.to_string()
    }
}

pub(crate) fn compute_purge_after(
    deleted_at: spacetimedb::Timestamp,
    retention_days: u32,
) -> spacetimedb::Timestamp {
    deleted_at + std::time::Duration::from_secs(u64::from(retention_days).saturating_mul(86_400))
}
