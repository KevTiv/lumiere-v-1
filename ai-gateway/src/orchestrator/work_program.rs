//! Immutable reusable-work manifests compiled into the existing governed runtime.
//!
//! A stored draft carries author intent, never authority or certification. The
//! first compiler resolves only existing reviewed read-only report graphs. New
//! dataset/sandbox adapters remain unavailable rather than guessing capability
//! bindings for Alpha modules. No route or production execution is enabled here.

#![allow(dead_code)]

use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    decision_graph::{validate_graph, DecisionGraph, DecisionNode},
    governed_program::{
        graph_hash, GovernedProgramContext, GovernedProgramExecutor, GovernedProgramOutcome,
    },
    governed_programs::governed_program_for_skill,
};

pub(crate) const MAX_MANIFEST_BYTES: usize = 65_536;
pub(crate) const PRODUCTION_WORK_PROGRAMS_ADMITTED: bool = false;

/// Product scope only; this enum grants no module or data permission.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AlphaModule {
    Accounting,
    Sales,
    Crm,
    Purchasing,
    Reports,
    Subscriptions,
    Expenses,
    Products,
    Warehouse,
    Fleet,
}

/// Content-addressed draft dependency. Dispatch still requires an independently
/// admitted profile/code version; a hash in this structure is not a certificate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WorkProgramDependency {
    pub key: String,
    pub version: u64,
    pub sha256: String,
}

/// Bounded versioned user intent with no trusted tenant/actor/budget fields.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WorkProgramManifest {
    pub schema_version: u32,
    pub program_key: String,
    pub version: u64,
    pub module: AlphaModule,
    pub reviewed_skill_key: String,
    pub application_contract: String,
    pub graph_hash: String,
    pub input_schema_ref: String,
    pub output_schema_ref: String,
    pub code_artifacts: Vec<WorkProgramDependency>,
    pub runtime_profiles: Vec<WorkProgramDependency>,
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
}

fn valid_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-:@/".contains(&byte))
}

impl WorkProgramManifest {
    /// Parse author input before persistence or compilation. Size checking comes
    /// before allocation by serde; duplicate and unknown fields are rejected.
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self> {
        ensure!(
            bytes.len() <= MAX_MANIFEST_BYTES,
            "work program manifest exceeds byte limit"
        );
        let manifest: Self =
            serde_json::from_slice(bytes).context("invalid work program manifest")?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub(crate) fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == 1,
            "unsupported work program schema version"
        );
        ensure!(valid_key(&self.program_key), "invalid work program key");
        ensure!(self.version > 0, "work program version must be positive");
        ensure!(
            valid_key(&self.reviewed_skill_key),
            "invalid reviewed skill key"
        );
        ensure!(
            valid_hash(&self.graph_hash),
            "invalid work program graph hash"
        );
        ensure!(
            valid_ref(&self.application_contract),
            "invalid application contract pin"
        );
        ensure!(
            !["latest", "main", "master", "dev", "head"]
                .contains(&self.application_contract.to_ascii_lowercase().as_str()),
            "application contract must be an immutable pin"
        );
        ensure!(
            valid_ref(&self.input_schema_ref),
            "invalid input schema reference"
        );
        ensure!(
            valid_ref(&self.output_schema_ref),
            "invalid output schema reference"
        );
        for dependencies in [&self.code_artifacts, &self.runtime_profiles] {
            ensure!(
                dependencies.len() <= 16,
                "too many work program dependencies"
            );
            let mut keys = std::collections::BTreeSet::new();
            for dependency in dependencies {
                ensure!(
                    valid_key(&dependency.key),
                    "invalid work program dependency key"
                );
                ensure!(
                    dependency.version > 0,
                    "work program dependency version must be positive"
                );
                ensure!(
                    valid_hash(&dependency.sha256),
                    "invalid work program dependency hash"
                );
                ensure!(
                    keys.insert(&dependency.key),
                    "duplicate work program dependency key"
                );
            }
        }
        ensure!(
            serde_json::to_vec(self)?.len() <= MAX_MANIFEST_BYTES,
            "work program manifest exceeds byte limit"
        );
        Ok(())
    }

    /// Stable typed encoding; whitespace and JSON object-key order are immaterial.
    /// Array order remains part of the immutable manifest identity.
    pub(crate) fn content_hash(&self) -> Result<String> {
        self.validate()?;
        Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(self)?)))
    }
}

/// Resolved by a trusted current release owner, never deserialized from author
/// input. The exact whole-manifest hash binds version, module and every dependency.
pub(crate) struct WorkProgramReleaseBinding<'a> {
    pub manifest_sha256: &'a str,
    pub application_contract: &'a str,
    pub input_schema_ref: &'a str,
    pub output_schema_ref: &'a str,
}

/// The compiled graph is the same graph and checkpoint identity used by the
/// canonical executor. Compilation alone authorizes no call.
#[derive(Debug)]
pub(crate) struct CompiledWorkProgram {
    pub(super) graph: DecisionGraph,
    pub(crate) manifest_sha256: String,
    pub(crate) program_ref: String,
    pub(crate) reviewed_skill_key: String,
}

fn admits_read_only_skill(module: AlphaModule, skill: &str) -> bool {
    match module {
        AlphaModule::Reports | AlphaModule::Accounting => {
            skill == "report_analysis" || lumiere_finance_review_core::skill(skill).is_ok()
        }
        AlphaModule::Expenses => skill == "expense_evidence_review",
        // Module discovery is not evidence of a reviewed dataset adapter.
        _ => false,
    }
}

/// Compile a pinned read-only report manifest into a reviewed existing graph.
/// New sandbox/user-authored graph semantics fail closed until their canonical
/// adapter is implemented and independently admitted.
pub(crate) fn compile_work_program(
    manifest: &WorkProgramManifest,
    binding: &WorkProgramReleaseBinding<'_>,
) -> Result<CompiledWorkProgram> {
    manifest.validate()?;
    ensure!(
        valid_hash(binding.manifest_sha256),
        "invalid released manifest hash"
    );
    let manifest_sha256 = manifest.content_hash()?;
    ensure!(
        manifest_sha256 == binding.manifest_sha256,
        "work program immutable version mismatch"
    );
    ensure!(
        manifest.application_contract == binding.application_contract,
        "work program application contract mismatch"
    );
    ensure!(
        manifest.input_schema_ref == binding.input_schema_ref,
        "work program input schema mismatch"
    );
    ensure!(
        manifest.output_schema_ref == binding.output_schema_ref,
        "work program output schema mismatch"
    );
    ensure!(
        manifest.code_artifacts.is_empty() && manifest.runtime_profiles.is_empty(),
        "work program sandbox adapter is unavailable pending runtime admission"
    );
    ensure!(
        admits_read_only_skill(manifest.module, &manifest.reviewed_skill_key),
        "work program module has no reviewed read-only source adapter for this skill"
    );
    let entry = governed_program_for_skill(&manifest.reviewed_skill_key)
        .context("work program reviewed skill is unavailable")?;
    validate_graph(&entry.graph)?;
    ensure!(
        graph_hash(&entry.graph) == manifest.graph_hash,
        "work program graph hash mismatch"
    );
    for node in &entry.graph.nodes {
        if matches!(node.kind, DecisionNode::RequireApproval(_)) {
            bail!("consequential work program steps are unsupported in Alpha");
        }
    }
    Ok(CompiledWorkProgram {
        graph: entry.graph,
        manifest_sha256,
        // Preserve the reviewed runtime identity: answer/evidence gates dispatch
        // by this canonical reference. The manifest hash is a separate binding.
        program_ref: entry.program_ref.to_string(),
        reviewed_skill_key: manifest.reviewed_skill_key.clone(),
    })
}

impl CompiledWorkProgram {
    /// Delegates to the canonical executor only after source admission. The
    /// current build deliberately has no production WorkProgram dispatcher.
    /// `run_manifest_sha256` must come from the durable run/version owner, not
    /// from request JSON or a freshly supplied author manifest.
    pub(super) async fn run(
        &self,
        executor: &GovernedProgramExecutor<'_>,
        context: &GovernedProgramContext,
        run_manifest_sha256: &str,
    ) -> Result<GovernedProgramOutcome> {
        ensure!(
            PRODUCTION_WORK_PROGRAMS_ADMITTED,
            "work program execution is unavailable pending release and certification"
        );
        self.validate_run_binding(context, run_manifest_sha256)?;
        executor.run(&self.graph, context).await
    }

    fn validate_run_binding(
        &self,
        context: &GovernedProgramContext,
        run_manifest_sha256: &str,
    ) -> Result<()> {
        ensure!(
            run_manifest_sha256 == self.manifest_sha256,
            "work program run manifest mismatch"
        );
        ensure!(
            context.program_ref == self.program_ref,
            "work program run version mismatch"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> WorkProgramManifest {
        let graph = governed_program_for_skill("report_analysis").unwrap().graph;
        WorkProgramManifest {
            schema_version: 1,
            program_key: "alpha-report".into(),
            version: 1,
            module: AlphaModule::Reports,
            reviewed_skill_key: "report_analysis".into(),
            application_contract: "v0.3.163".into(),
            graph_hash: graph_hash(&graph),
            input_schema_ref: "report-analysis.input.v1".into(),
            output_schema_ref: "report-analysis.output.v1".into(),
            code_artifacts: vec![],
            runtime_profiles: vec![],
        }
    }

    fn compile(manifest: &WorkProgramManifest) -> Result<CompiledWorkProgram> {
        let hash = manifest.content_hash()?;
        compile_work_program(
            manifest,
            &WorkProgramReleaseBinding {
                manifest_sha256: &hash,
                application_contract: &manifest.application_contract,
                input_schema_ref: &manifest.input_schema_ref,
                output_schema_ref: &manifest.output_schema_ref,
            },
        )
    }

    #[test]
    fn compilation_reuses_reviewed_graph_and_version_identity() {
        let manifest = manifest();
        let compiled = compile(&manifest).unwrap();
        assert_eq!(graph_hash(&compiled.graph), manifest.graph_hash);
        assert_eq!(
            compiled.program_ref,
            super::super::governed_programs::REPORT_ANALYSIS_PROGRAM_REF
        );
        assert_eq!(compiled.manifest_sha256, manifest.content_hash().unwrap());
        assert!(!PRODUCTION_WORK_PROGRAMS_ADMITTED);
    }

    #[test]
    fn canonical_answer_gate_identity_and_manifest_binding_are_both_required() {
        let candidate = manifest();
        let compiled = compile(&candidate).unwrap();
        let mut context = GovernedProgramContext {
            organization_id: 1,
            company_id: 2,
            run_id: 3,
            program_ref: compiled.program_ref.clone(),
            objective: "review report".into(),
            bounded_state: serde_json::json!({}),
            evidence: vec![],
            generation_instructions: None,
            generation_max_tokens: None,
        };
        assert!(compiled
            .validate_run_binding(&context, &compiled.manifest_sha256)
            .is_ok());
        assert!(compiled
            .validate_run_binding(&context, &"0".repeat(64))
            .is_err());
        context.program_ref = format!("work-program:{}", compiled.manifest_sha256);
        assert!(compiled
            .validate_run_binding(&context, &compiled.manifest_sha256)
            .is_err());
    }

    #[test]
    fn forged_authority_and_duplicate_fields_reject_before_compilation() {
        let base = serde_json::to_value(manifest()).unwrap();
        for key in [
            "organizationId",
            "actorIdentity",
            "companyId",
            "certified",
            "budget",
            "sql",
        ] {
            let mut forged = base.clone();
            forged[key] = serde_json::json!("forged");
            assert!(
                WorkProgramManifest::parse(&serde_json::to_vec(&forged).unwrap()).is_err(),
                "{key}"
            );
        }
        let encoded = serde_json::to_string(&manifest()).unwrap();
        let duplicate = encoded.replacen('{', "{\"version\":2,", 1);
        assert!(WorkProgramManifest::parse(duplicate.as_bytes()).is_err());
        assert!(WorkProgramManifest::parse(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
    }

    #[test]
    fn publication_pin_rejects_a_changed_version_or_dependency() {
        let original = manifest();
        let hash = original.content_hash().unwrap();
        let mut changed = original.clone();
        changed.version += 1;
        assert!(compile_work_program(
            &changed,
            &WorkProgramReleaseBinding {
                manifest_sha256: &hash,
                application_contract: &original.application_contract,
                input_schema_ref: &original.input_schema_ref,
                output_schema_ref: &original.output_schema_ref,
            }
        )
        .is_err());
        changed = original;
        changed.graph_hash = "0".repeat(64);
        assert!(compile(&changed)
            .unwrap_err()
            .to_string()
            .contains("graph hash"));
    }

    #[test]
    fn unsupported_sources_and_sandbox_dependencies_cannot_be_compiled() {
        let mut candidate = manifest();
        for module in [
            AlphaModule::Sales,
            AlphaModule::Crm,
            AlphaModule::Purchasing,
            AlphaModule::Subscriptions,
            AlphaModule::Products,
            AlphaModule::Warehouse,
            AlphaModule::Fleet,
        ] {
            candidate.module = module;
            assert!(compile(&candidate).is_err());
        }
        candidate = manifest();
        candidate.reviewed_skill_key = "supplier_discovery".into();
        assert!(compile(&candidate).is_err());
        candidate = manifest();
        candidate.runtime_profiles.push(WorkProgramDependency {
            key: "quickjs".into(),
            version: 1,
            sha256: "a".repeat(64),
        });
        assert!(compile(&candidate)
            .unwrap_err()
            .to_string()
            .contains("sandbox adapter"));
    }

    #[test]
    fn manifest_identity_is_independent_of_input_json_key_order_and_whitespace() {
        let candidate = manifest();
        let value = serde_json::to_value(&candidate).unwrap();
        let parsed =
            WorkProgramManifest::parse(serde_json::to_string_pretty(&value).unwrap().as_bytes())
                .unwrap();
        assert_eq!(
            candidate.content_hash().unwrap(),
            parsed.content_hash().unwrap()
        );
        let mut bad = candidate;
        bad.graph_hash = "A".repeat(64);
        assert!(bad.validate().is_err());
        bad.graph_hash = "a".repeat(64);
        bad.runtime_profiles = vec![
            WorkProgramDependency {
                key: "quickjs".into(),
                version: 1,
                sha256: "a".repeat(64)
            };
            2
        ];
        assert!(bad.validate().is_err());
    }

    #[test]
    fn every_existing_finance_graph_uses_the_same_compiler() {
        for skill in lumiere_finance_review_core::SKILLS {
            let mut candidate = manifest();
            candidate.module = AlphaModule::Accounting;
            candidate.reviewed_skill_key = skill.key.into();
            candidate.graph_hash =
                graph_hash(&governed_program_for_skill(skill.key).unwrap().graph);
            let compiled = compile(&candidate).unwrap();
            assert_eq!(
                compiled.program_ref, skill.program,
                "canonical evidence gate owner for {}",
                skill.key
            );
            assert_eq!(compiled.manifest_sha256, candidate.content_hash().unwrap());
        }
    }
}
