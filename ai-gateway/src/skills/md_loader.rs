use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const SKILL_FILE: &str = "SKILL.md";
pub const PROMPT_COMPILER_VERSION: &str = "erp-prompt-v2";
const MAX_PROMPT_BYTES: usize = 65_536;

#[derive(Debug, Clone, serde::Serialize)]
pub struct PromptDependency {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CompiledSkillPrompt {
    pub text: String,
    pub compiler: &'static str,
    pub source_hash: String,
    pub dependencies: Vec<PromptDependency>,
}

#[derive(Debug, Clone)]
pub struct BundledSkillMd {
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub references: Vec<String>,
    pub body: String,
    pub source_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SyncSkillPayload {
    pub skill_key: String,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub prompt_template: String,
    pub required_tools: Vec<String>,
    pub optional_tools: Vec<String>,
    pub default_max_steps: u32,
    pub default_max_tool_calls: u32,
    pub dataset_specs: Option<String>,
    pub allowed_action_drafts: Vec<String>,
    pub metadata: String,
}

pub fn resolve_skills_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("ERP_SKILLS_DIR") {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            return path;
        }
    }
    for candidate in ["erp-skills", "../erp-skills", "../../erp-skills"] {
        let path = PathBuf::from(candidate);
        if path.is_dir() {
            return path;
        }
    }
    PathBuf::from("erp-skills")
}

pub fn discover_bundled_skills() -> Result<Vec<BundledSkillMd>> {
    let root = resolve_skills_dir();
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(&root).context("read erp-skills directory")? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let skill_md = entry.path().join(SKILL_FILE);
        if !skill_md.is_file() {
            continue;
        }
        out.push(parse_skill_md(&skill_md)?);
    }
    out.sort_by(|a, b| a.skill_key.cmp(&b.skill_key));
    Ok(out)
}

pub fn load_bundled_skill(skill_key: &str) -> Result<Option<BundledSkillMd>> {
    validate_skill_key(skill_key)?;
    let path = resolve_skills_dir().join(skill_key).join(SKILL_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    parse_skill_md(&path).map(Some)
}

pub fn bundled_to_sync_payload(md: &BundledSkillMd) -> Result<SyncSkillPayload> {
    let compiled = compile_prompt(md)?;
    Ok(SyncSkillPayload {
        skill_key: md.skill_key.clone(),
        name: md.name.clone(),
        description: md.description.clone(),
        category: md.category.clone(),
        prompt_template: compiled.text,
        required_tools: md.required_tools.clone(),
        optional_tools: md.optional_tools.clone(),
        default_max_steps: md.default_max_steps,
        default_max_tool_calls: md.default_max_tool_calls,
        dataset_specs: md.dataset_specs.clone(),
        allowed_action_drafts: md.allowed_action_drafts.clone(),
        metadata: serde_json::json!({
            "source": "bundled_md",
            "path": md.source_path.to_string_lossy(),
            "compiler": compiled.compiler,
            "source_hash": compiled.source_hash,
            "dependencies": compiled.dependencies,
        })
        .to_string(),
    })
}

pub fn compose_prompt(md: &BundledSkillMd) -> Result<String> {
    Ok(compile_prompt(md)?.text)
}

/// All declared resources are required. Compilation is deterministic and never
/// lets a missing or escaped file silently remove part of the procedure.
pub fn compile_prompt(md: &BundledSkillMd) -> Result<CompiledSkillPrompt> {
    let mut prompt = md.body.trim().to_string();
    let skill_dir = md
        .source_path
        .parent()
        .context("skill source has no parent directory")?
        .canonicalize()
        .context("resolve skill directory")?;
    anyhow::ensure!(
        md.source_path.canonicalize()?.starts_with(&skill_dir),
        "skill source escapes package"
    );
    anyhow::ensure!(
        fs::metadata(&md.source_path)?.len() <= MAX_PROMPT_BYTES as u64,
        "skill file exceeds byte bound"
    );
    let source = fs::read(&md.source_path).context("read skill dependency")?;
    let mut dependencies = vec![PromptDependency {
        path: SKILL_FILE.into(),
        sha256: format!("sha256:{:x}", Sha256::digest(&source)),
    }];
    let mut hash = Sha256::new();
    hash.update(PROMPT_COMPILER_VERSION.as_bytes());
    let mut seen = std::collections::HashSet::new();
    let mut reference_blocks = Vec::new();
    for rel in &md.references {
        anyhow::ensure!(seen.insert(rel), "duplicate skill reference: {rel}");
        anyhow::ensure!(
            Path::new(rel)
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_))),
            "skill reference must be package-relative: {rel}"
        );
        let path = skill_dir
            .join(rel)
            .canonicalize()
            .with_context(|| format!("resolve required skill reference: {rel}"))?;
        anyhow::ensure!(
            path.starts_with(&skill_dir),
            "skill reference escapes package: {rel}"
        );
        anyhow::ensure!(path.is_file(), "skill reference is not a file: {rel}");
        anyhow::ensure!(
            fs::metadata(&path)?.len() <= MAX_PROMPT_BYTES as u64,
            "skill reference exceeds byte bound: {rel}"
        );
        let content = fs::read_to_string(&path)
            .with_context(|| format!("read required skill reference: {rel}"))?;
        dependencies.push(PromptDependency {
            path: rel.clone(),
            sha256: format!("sha256:{:x}", Sha256::digest(content.as_bytes())),
        });
        reference_blocks.push(format!("### Reference: {rel}\n\n{}", content.trim()));
    }

    if !reference_blocks.is_empty() {
        prompt.push_str("\n\n## Reference context\n\n");
        prompt.push_str(&reference_blocks.join("\n\n"));
    }
    anyhow::ensure!(
        prompt.len() <= MAX_PROMPT_BYTES,
        "compiled skill prompt exceeds byte bound"
    );
    for dependency in &dependencies {
        hash.update((dependency.path.len() as u64).to_be_bytes());
        hash.update(dependency.path.as_bytes());
        hash.update(dependency.sha256.as_bytes());
    }
    // Bind actual composed text too, including injected body changes in callers.
    hash.update(prompt.as_bytes());
    Ok(CompiledSkillPrompt {
        text: prompt,
        compiler: PROMPT_COMPILER_VERSION,
        source_hash: format!("sha256:{:x}", hash.finalize()),
        dependencies,
    })
}

fn parse_skill_md(path: &Path) -> Result<BundledSkillMd> {
    anyhow::ensure!(
        fs::metadata(path)?.len() <= MAX_PROMPT_BYTES as u64,
        "skill file exceeds byte bound"
    );
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read skill markdown {}", path.display()))?;
    let (frontmatter, body) = split_frontmatter(&raw)?;
    anyhow::ensure!(
        raw.len() <= MAX_PROMPT_BYTES,
        "skill file exceeds byte bound"
    );
    let fields = parse_frontmatter(&frontmatter)?;

    let skill_key = required_string(&fields, "skill_key")?;
    validate_skill_key(&skill_key)?;
    anyhow::ensure!(
        path.parent()
            .and_then(Path::file_name)
            .and_then(|s| s.to_str())
            == Some(&skill_key),
        "skill key must match its directory"
    );
    for key in ["default_max_steps", "default_max_tool_calls"] {
        if let Some(value) = fields.get(key) {
            anyhow::ensure!(
                value.parse::<u32>().is_ok_and(|n| n > 0),
                "{key} must be a positive integer"
            );
        }
    }
    let md = BundledSkillMd {
        skill_key: skill_key.clone(),
        name: fields
            .get("name")
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or(skill_key),
        description: fields.get("description").cloned(),
        category: fields
            .get("category")
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "general".to_string()),
        required_tools: parse_string_list(fields.get("required_tools")),
        optional_tools: parse_string_list(fields.get("optional_tools")),
        default_max_steps: fields
            .get("default_max_steps")
            .and_then(|s| s.parse().ok())
            .unwrap_or(5),
        default_max_tool_calls: fields
            .get("default_max_tool_calls")
            .and_then(|s| s.parse().ok())
            .unwrap_or(12),
        dataset_specs: fields.get("dataset_specs").cloned(),
        allowed_action_drafts: parse_string_list(fields.get("allowed_action_drafts")),
        references: parse_string_list(fields.get("references")),
        body: body.trim().to_string(),
        source_path: path.to_path_buf(),
    };
    compile_prompt(&md)?;
    Ok(md)
}

fn validate_skill_key(key: &str) -> Result<()> {
    anyhow::ensure!(
        !key.is_empty()
            && key.len() <= 64
            && key
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-'),
        "invalid bundled skill key"
    );
    Ok(())
}

fn split_frontmatter(raw: &str) -> Result<(String, String)> {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return Ok((String::new(), raw.to_string()));
    }
    let rest = trimmed.trim_start_matches("---").trim_start();
    let Some((front, body)) = rest.split_once("\n---") else {
        anyhow::bail!("skill frontmatter must close with ---");
    };
    Ok((front.to_string(), body.trim_start().to_string()))
}

fn parse_frontmatter(input: &str) -> Result<std::collections::HashMap<String, String>> {
    let mut fields = std::collections::HashMap::new();
    let mut lines = input.lines().peekable();
    while let Some(line) = lines.next() {
        if line.trim().is_empty() {
            continue;
        }
        anyhow::ensure!(
            !line.starts_with(char::is_whitespace),
            "unexpected indented skill metadata"
        );
        let (key, value) = line
            .split_once(':')
            .context("invalid skill metadata line")?;
        let key = key.trim();
        anyhow::ensure!(
            !fields.contains_key(key),
            "duplicate skill metadata key: {key}"
        );
        anyhow::ensure!(
            [
                "skill_key",
                "name",
                "description",
                "category",
                "status",
                "required_tools",
                "optional_tools",
                "default_max_steps",
                "default_max_tool_calls",
                "allowed_action_drafts",
                "references",
                "dataset_specs"
            ]
            .contains(&key),
            "unknown skill metadata key: {key}"
        );
        let value = value.trim();
        let parsed = if value == "|" || value.is_empty() {
            let mut block = Vec::new();
            while lines.peek().is_some_and(|next| next.starts_with("  ")) {
                let next = lines.next().context("missing metadata continuation")?;
                if value == "|" {
                    block.push(next[2..].to_string());
                } else {
                    block.push(
                        next.strip_prefix("  - ")
                            .context("metadata list requires dash items")?
                            .trim()
                            .to_string(),
                    );
                }
            }
            // Preserve a one-item list's representation for parse_string_list.
            if value.is_empty() && !block.is_empty() {
                block.push(String::new());
            }
            block.join("\n")
        } else if value.starts_with('[') && value.ends_with(']') {
            value[1..value.len() - 1].to_string()
        } else {
            value.trim_matches('"').to_string()
        };
        fields.insert(key.to_string(), parsed);
    }
    Ok(fields)
}

fn parse_string_list(raw: Option<&String>) -> Vec<String> {
    let Some(raw) = raw else {
        return Vec::new();
    };
    if raw.contains('\n') {
        return raw
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect();
    }
    raw.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn required_string(
    fields: &std::collections::HashMap<String, String>,
    key: &str,
) -> Result<String> {
    fields
        .get(key)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("missing required frontmatter field '{key}'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_list_frontmatter() {
        let md = r#"---
skill_key: demo
name: Demo
category: test
required_tools:
  - erp_search
  - save_artifact
---
Body text."#;
        let (front, body) = split_frontmatter(md).unwrap();
        let fields = parse_frontmatter(&front).unwrap();
        assert_eq!(body, "Body text.");
        assert_eq!(
            parse_string_list(fields.get("required_tools")),
            vec!["erp_search".to_string(), "save_artifact".to_string(),]
        );
    }
}

#[cfg(test)]
mod compilation_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Package(PathBuf);
    impl Package {
        fn new(extra: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "erp-skill-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("demo")).unwrap();
            fs::write(
                path.join("demo/SKILL.md"),
                format!("---\nskill_key: demo\nname: Demo\n{extra}---\nProcedure.\n"),
            )
            .unwrap();
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("demo/SKILL.md")
        }
    }
    impl Drop for Package {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn required_reference_changes_the_compiled_text_and_binding() {
        let package = Package::new("references:\n  - example.md\n");
        fs::write(package.0.join("demo/example.md"), "First observation.").unwrap();
        let md = parse_skill_md(&package.file()).unwrap();
        let first = compile_prompt(&md).unwrap();
        assert_eq!(first.dependencies.len(), 2);
        assert!(first.text.contains("First observation."));
        assert_eq!(first.source_hash, compile_prompt(&md).unwrap().source_hash);
        fs::write(package.0.join("demo/example.md"), "Changed observation.").unwrap();
        let changed = compile_prompt(&md).unwrap();
        assert!(changed.text.contains("Changed observation."));
        assert_ne!(first.source_hash, changed.source_hash);
        fs::remove_file(package.0.join("demo/example.md")).unwrap();
        assert!(compile_prompt(&md).is_err());
    }

    #[test]
    fn malformed_metadata_missing_and_escaped_assets_reject() {
        for metadata in [
            "name: Duplicate\n",
            "unknown: value\n",
            "default_max_steps: 0\n",
            "required_tools:\n  not-a-list\n",
            "references:\n  - missing.md\n",
            "references:\n  - ../outside.md\n",
            "references:\n  - /etc/passwd\n",
        ] {
            let package = Package::new(metadata);
            assert!(parse_skill_md(&package.file()).is_err(), "{metadata}");
        }
        assert!(load_bundled_skill("../outside").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_reference_cannot_escape_the_package() {
        let package = Package::new("references:\n  - escaped.md\n");
        fs::write(package.0.join("outside.md"), "Outside content").unwrap();
        std::os::unix::fs::symlink(
            package.0.join("outside.md"),
            package.0.join("demo/escaped.md"),
        )
        .unwrap();
        assert!(parse_skill_md(&package.file()).is_err());
    }

    #[test]
    fn oversized_and_duplicate_resources_reject() {
        let package = Package::new("references:\n  - example.md\n  - example.md\n");
        fs::write(package.0.join("demo/example.md"), "Example").unwrap();
        assert!(parse_skill_md(&package.file()).is_err());
        fs::write(package.file(), "x".repeat(MAX_PROMPT_BYTES + 1)).unwrap();
        assert!(parse_skill_md(&package.file()).is_err());
    }

    #[test]
    fn documented_finance_and_deterministic_inputs_match_closed_contracts() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../erp-skills");
        for key in [
            "bank_reconciliation_review",
            "period_close_review",
            "expense_evidence_review",
            "finance_variance_review",
            "daily_briefing",
            "insights_scan",
            "import_mapping",
        ] {
            let md = parse_skill_md(&root.join(key).join(SKILL_FILE)).unwrap();
            let json = md
                .body
                .split("```json\n")
                .nth(1)
                .unwrap()
                .split("```")
                .next()
                .unwrap();
            let input: serde_json::Value = serde_json::from_str(json).unwrap();
            match key {
                "daily_briefing" => {
                    serde_json::from_value::<crate::harness::daily_briefing::DailyBriefingInput>(
                        input,
                    )
                    .unwrap();
                }
                "insights_scan" => {
                    serde_json::from_value::<crate::harness::insights_scan::InsightsScanInput>(
                        input,
                    )
                    .unwrap();
                }
                "import_mapping" => {
                    serde_json::from_value::<crate::harness::import_mapping::ImportMappingInput>(
                        input,
                    )
                    .unwrap();
                }
                _ => {
                    lumiere_finance_review_core::parse_input(key, &input).unwrap();
                }
            }
        }
    }

    #[test]
    fn generated_catalog_matches_real_compiler_and_reviewed_tool_allowlists() {
        use crate::harness::{manifest::SkillVersionRef, skill_registry::SkillRegistry};
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../erp-skills/catalog.json")).unwrap();
        let registry = SkillRegistry::built_in();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../erp-skills");
        assert_eq!(catalog["skills"].as_array().unwrap().len(), 15);
        for entry in catalog["skills"].as_array().unwrap() {
            let key = entry["key"].as_str().unwrap();
            let md = parse_skill_md(&root.join(key).join(SKILL_FILE)).unwrap();
            let compiled = compile_prompt(&md).unwrap();
            assert_eq!(
                entry["prompt"]["source_hash"], compiled.source_hash,
                "{key}"
            );
            assert_eq!(
                entry["prompt"]["dependencies"],
                serde_json::to_value(&compiled.dependencies).unwrap()
            );
            if let Some(manifest) = registry.get(&SkillVersionRef::new(key, 1)) {
                for tool in md.required_tools.iter().chain(&md.optional_tools) {
                    assert!(
                        manifest.allowed_tools.contains(tool),
                        "{key} advertises unreviewed tool {tool}"
                    );
                }
            } else {
                assert_eq!(entry["mode"], "internal_generation");
                assert!(md.required_tools.is_empty() && md.optional_tools.is_empty());
            }
        }
    }
}
