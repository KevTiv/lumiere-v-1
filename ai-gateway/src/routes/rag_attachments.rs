//! Small, request-scoped user files. They are not persisted ERP evidence or instructions.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::orchestrator::{
    intelligence::EvidenceRef,
    text_answer_gate::{PassageStatus, SourcePassage, TextEvidence},
};

const MAX_FILES: usize = 3;
const MAX_BYTES: usize = 4 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ChatAttachment {
    pub name: String,
    pub text: String,
}

pub(super) fn validate(attachments: &[ChatAttachment]) -> Result<()> {
    if attachments.len() > MAX_FILES {
        bail!("Choose up to 3 text attachments");
    }
    for file in attachments {
        let extension = file
            .name
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if file.name.len() > 255
            || file
                .name
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
            || !file.name.contains('.')
            || !matches!(extension.as_str(), "txt" | "md" | "csv" | "tsv" | "json")
            || file.text.trim().is_empty()
            || file.text.len() > MAX_BYTES
            || file.text.contains('\0')
        {
            bail!("Attachments must be non-empty UTF-8 text files up to 4 KB each");
        }
    }
    Ok(())
}

impl ChatAttachment {
    pub fn support_ref(&self) -> EvidenceRef {
        // Bind the display name as well as contents; duplicate names cannot alias
        // different files. No client-selected passage/entity identity is accepted.
        let mut hash = Sha256::new();
        hash.update(self.name.as_bytes());
        hash.update([0]);
        hash.update(self.text.as_bytes());
        EvidenceRef {
            kind: "user_attachment".into(),
            id: format!("{:x}", hash.finalize()),
        }
    }

    pub fn add_to_evidence(&self, evidence: &mut TextEvidence) {
        let reference = self.support_ref();
        evidence.add_ref(&reference.kind, &reference.id);
        evidence.add_user_text(&self.text);
        // Reuse the reviewer's text-source representation, not the persisted
        // passage catalog. id=0 is deliberately never a database passage id.
        evidence.request_sources.push(SourcePassage {
            id: 0,
            kind: reference.kind,
            source_key: reference.id.clone(),
            version: reference.id.clone(),
            passage_key: "submitted_text".into(),
            content_hash: reference.id,
            text: serde_json::json!({
                "provenance": "unverified user-provided file, not ERP state",
                "name": self.name,
                "text": self.text,
            })
            .to_string(),
            effective_from_micros: None,
            effective_to_micros: None,
            applicability: Vec::new(),
            status: PassageStatus::Current,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, text: &str) -> ChatAttachment {
        ChatAttachment {
            name: name.into(),
            text: text.into(),
        }
    }

    #[test]
    fn validates_count_extensions_utf8_bytes_and_names() {
        for name in ["a.txt", "a.MD", "a.csv", "a.tsv", "a.json"] {
            assert!(validate(&[file(name, &"é".repeat(2048))]).is_ok());
        }
        for (name, text) in [
            ("a.pdf", "text"),
            ("txt", "text"),
            ("../a.txt", "text"),
            ("a\n.txt", "text"),
            ("a.txt", ""),
            ("a.txt", " \n"),
            ("a.txt", "a\0b"),
        ] {
            assert!(validate(&[file(name, text)]).is_err());
        }
        assert!(validate(&[file("a.txt", &"é".repeat(2049))]).is_err());
        assert!(validate(&(0..4).map(|_| file("a.txt", "text")).collect::<Vec<_>>()).is_err());
    }

    #[test]
    fn request_support_is_content_bound_and_never_an_erp_identity() {
        let original = file("a.txt", "The user counted 42 eggs.");
        assert_ne!(
            original.support_ref(),
            file("a.txt", "43 eggs").support_ref()
        );
        assert_ne!(
            original.support_ref(),
            file("b.txt", &original.text).support_ref()
        );
        let mut evidence = TextEvidence::default();
        original.add_to_evidence(&mut evidence);
        assert_eq!(evidence.refs, vec![original.support_ref()]);
        assert_eq!(evidence.refs[0].kind, "user_attachment");
        assert!(evidence.figures.contains(&42.0));
        assert!(serde_json::from_value::<ChatAttachment>(serde_json::json!({
            "name": "a.txt", "text": "text", "company_id": 999
        }))
        .is_err());
    }
}
