use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

const SKILL_FILE: &str = "SKILL.md";

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
    let path = resolve_skills_dir().join(skill_key).join(SKILL_FILE);
    if !path.is_file() {
        return Ok(None);
    }
    parse_skill_md(&path).map(Some)
}

pub fn bundled_to_sync_payload(md: &BundledSkillMd) -> SyncSkillPayload {
    SyncSkillPayload {
        skill_key: md.skill_key.clone(),
        name: md.name.clone(),
        description: md.description.clone(),
        category: md.category.clone(),
        prompt_template: compose_prompt(md),
        required_tools: md.required_tools.clone(),
        optional_tools: md.optional_tools.clone(),
        default_max_steps: md.default_max_steps,
        default_max_tool_calls: md.default_max_tool_calls,
        dataset_specs: md.dataset_specs.clone(),
        allowed_action_drafts: md.allowed_action_drafts.clone(),
        metadata: serde_json::json!({
            "source": "bundled_md",
            "path": md.source_path.to_string_lossy(),
        })
        .to_string(),
    }
}

pub fn compose_prompt(md: &BundledSkillMd) -> String {
    let mut prompt = md.body.trim().to_string();
    if md.references.is_empty() {
        return prompt;
    }

    let skill_dir = md
        .source_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| resolve_skills_dir().join(&md.skill_key));

    let mut reference_blocks = Vec::new();
    for rel in &md.references {
        let path = skill_dir.join(rel);
        if !path.is_file() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        reference_blocks.push(format!("### Reference: {rel}\n\n{}", content.trim()));
    }

    if !reference_blocks.is_empty() {
        prompt.push_str("\n\n## Reference context\n\n");
        prompt.push_str(&reference_blocks.join("\n\n"));
    }
    prompt
}

fn parse_skill_md(path: &Path) -> Result<BundledSkillMd> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read skill markdown {}", path.display()))?;
    let (frontmatter, body) = split_frontmatter(&raw)?;
    let fields = parse_frontmatter(&frontmatter);

    let skill_key = required_string(&fields, "skill_key")?;
    Ok(BundledSkillMd {
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
    })
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

fn parse_frontmatter(input: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut current_key: Option<String> = None;
    let mut block_lines: Vec<String> = Vec::new();
    let mut in_block = false;

    let flush = |map: &mut std::collections::HashMap<String, String>,
                 key: &mut Option<String>,
                 block: &mut Vec<String>,
                 in_block: &mut bool| {
        if let Some(k) = key.take() {
            let value = if *in_block {
                block.join("\n").trim().to_string()
            } else {
                block.first().cloned().unwrap_or_default()
            };
            map.insert(k, value);
            block.clear();
            *in_block = false;
        }
    };

    for line in input.lines() {
        if in_block {
            if line.starts_with("  - ") {
                block_lines.push(line[4..].trim().to_string());
                continue;
            }
            if line.starts_with("  ") {
                if let Some(last) = block_lines.last_mut() {
                    last.push('\n');
                    last.push_str(line.trim_start());
                }
                continue;
            }
            flush(&mut map, &mut current_key, &mut block_lines, &mut in_block);
        }

        if let Some((key, value)) = line.split_once(':') {
            current_key = Some(key.trim().to_string());
            let value = value.trim();
            if value.is_empty() {
                in_block = true;
                block_lines.clear();
            } else if value.starts_with('[') && value.ends_with(']') {
                map.insert(
                    current_key.take().unwrap(),
                    value.trim_matches(['[', ']']).to_string(),
                );
            } else {
                block_lines = vec![value.trim_matches('"').to_string()];
                flush(&mut map, &mut current_key, &mut block_lines, &mut in_block);
            }
        }
    }
    flush(&mut map, &mut current_key, &mut block_lines, &mut in_block);
    map
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
        let fields = parse_frontmatter(&front);
        assert_eq!(body, "Body text.");
        assert_eq!(
            parse_string_list(fields.get("required_tools")),
            vec!["erp_search".to_string(), "save_artifact".to_string(),]
        );
    }
}
